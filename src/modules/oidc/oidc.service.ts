import { createHash } from 'node:crypto';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import type { OAuthClient, PrismaClient, User } from '../../generated/prisma/client.js';
import { BadRequestError, ForbiddenError, NotFoundError, UnauthorizedError } from '../../shared/errors/app-error.js';
import { randomToken, safeEqual, sha256 } from '../../shared/utils/crypto.js';
import { durationToMs } from '../../shared/utils/duration.js';
import type { RequestContext } from '../auth/auth.service.js';
import type { SessionService } from '../auth/session.service.js';
import type { AccessTokens } from '../auth/tokens.js';
import type { SigningKeyStore } from '../keys/signing-key.store.js';
import type { ClientService } from './client.service.js';
import { invalidGrant, invalidRequest, OAuthError } from './oidc.errors.js';
import { SUPPORTED_SCOPES } from './oidc.schemas.js';

const INTERACTION_TTL_MS = 10 * 60 * 1000;
const CODE_TTL_MS = 60 * 1000;
const ID_TOKEN_TTL = '10m';

type Params = Record<string, unknown>;

const stringParam = (params: Params, name: string): string | undefined =>
    typeof params[name] === 'string' && params[name] !== '' ? (params[name] as string) : undefined;

const withParams = (base: string, params: Record<string, string | undefined>): string => {
    const url = new URL(base);
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) url.searchParams.set(key, value);
    }
    return url.toString();
};

const pkceChallenge = (verifier: string) => createHash('sha256').update(verifier).digest('base64url');

export interface TokenResponse {
    access_token: string;
    token_type: 'Bearer';
    expires_in: number;
    scope: string;
    id_token?: string;
    refresh_token?: string;
}

// OpenID Connect provider: authorization code flow with PKCE, refresh tokens, ID tokens
// and userinfo. "Headless": the authorization endpoint hands the user to the front end's
// login page (OIDC_LOGIN_URL), which signs them in with the regular API and then
// completes the interaction.
export class OidcService {
    constructor(
        private readonly db: PrismaClient,
        private readonly clients: ClientService,
        private readonly sessions: SessionService,
        private readonly accessTokens: AccessTokens,
        private readonly signingKeys: SigningKeyStore
    ) {}

    // GET /oauth/authorize. Returns where to redirect the browser.
    async authorize(params: Params): Promise<string> {
        const clientId = stringParam(params, 'client_id');
        const redirectUri = stringParam(params, 'redirect_uri');
        const client = clientId ? await this.clients.find(clientId) : null;

        // Never redirect to an unverified URI: answer these two directly (open redirect protection)
        if (!client) throw new BadRequestError('Unknown client_id', 'INVALID_CLIENT');
        if (!redirectUri || !client.redirectUris.includes(redirectUri)) {
            throw new BadRequestError('redirect_uri is not registered for this client', 'INVALID_REDIRECT_URI');
        }

        const state = stringParam(params, 'state');
        const fail = (error: string, description: string) =>
            withParams(redirectUri, { error, error_description: description, state, iss: env.OIDC_ISSUER });

        if (stringParam(params, 'response_type') !== 'code') {
            return fail('unsupported_response_type', 'Only the authorization code flow (response_type=code) is supported');
        }

        const scopes = (stringParam(params, 'scope') ?? '').split(' ').filter(Boolean);
        if (!scopes.includes('openid')) return fail('invalid_scope', 'The openid scope is required');
        const notAllowed = scopes.filter((scope) => !client.scopes.includes(scope));
        if (notAllowed.length > 0) return fail('invalid_scope', `Scope not allowed for this client: ${notAllowed.join(' ')}`);

        const codeChallenge = stringParam(params, 'code_challenge');
        if (stringParam(params, 'code_challenge_method') !== 'S256' || !codeChallenge || !/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
            return fail('invalid_request', 'PKCE is required: send code_challenge with code_challenge_method=S256');
        }

        // The user always signs in through the front end, so silent authentication isn't possible
        if ((stringParam(params, 'prompt') ?? '').split(' ').includes('none')) {
            return fail('login_required', 'The user must sign in');
        }

        const interaction = await this.db.oAuthInteraction.create({
            data: {
                id: randomToken(32),
                clientId: client.id,
                redirectUri,
                scope: [...new Set(scopes)].join(' '),
                state,
                nonce: stringParam(params, 'nonce'),
                codeChallenge,
                expiresAt: new Date(Date.now() + INTERACTION_TTL_MS),
            },
        });

        return withParams(env.OIDC_LOGIN_URL, { interaction: interaction.id });
    }

    // What the login page shows: which app is asking for what
    async getInteraction(interactionId: string) {
        const interaction = await this.findInteraction(interactionId);
        return {
            id: interaction.id,
            client: { name: interaction.client.name, firstParty: interaction.client.firstParty },
            scopes: interaction.scope.split(' '),
            expiresAt: interaction.expiresAt,
        };
    }

    // Called by the front end once the user is signed in. Third-party clients need the
    // user's consent once per scope set. Returns where to send the browser back to.
    async completeInteraction(
        interactionId: string,
        { userId, sessionId }: { userId: string; sessionId: string },
        consent?: boolean
    ): Promise<{ redirectTo: string }> {
        const interaction = await this.findInteraction(interactionId);
        const scopes = interaction.scope.split(' ');
        const back = (params: Record<string, string>) =>
            withParams(interaction.redirectUri, { ...params, state: interaction.state ?? undefined, iss: env.OIDC_ISSUER });

        if (consent === false) {
            await this.db.oAuthInteraction.deleteMany({ where: { id: interaction.id } });
            return { redirectTo: back({ error: 'access_denied', error_description: 'The user denied the request' }) };
        }

        if (!interaction.client.firstParty) {
            const existing = await this.db.oAuthConsent.findUnique({
                where: { userId_clientId: { userId, clientId: interaction.clientId } },
            });
            const covered = scopes.every((scope) => existing?.scopes.includes(scope));
            if (!covered) {
                if (consent !== true) {
                    throw new ForbiddenError('The user has to approve the requested scopes', 'CONSENT_REQUIRED');
                }
                const granted = [...new Set([...(existing?.scopes ?? []), ...scopes])];
                await this.db.oAuthConsent.upsert({
                    where: { userId_clientId: { userId, clientId: interaction.clientId } },
                    create: { userId, clientId: interaction.clientId, scopes: granted },
                    update: { scopes: granted },
                });
            }
        }

        // Single use: of two concurrent completions only one gets a code
        const { count } = await this.db.oAuthInteraction.deleteMany({ where: { id: interaction.id } });
        if (count !== 1) throw new NotFoundError('Authorization request not found or expired', 'INTERACTION_NOT_FOUND');

        const session = await this.db.session.findUnique({ where: { id: sessionId }, select: { createdAt: true } });
        const code = randomToken(32);
        await this.db.authorizationCode.create({
            data: {
                codeHash: sha256(code),
                clientId: interaction.clientId,
                userId,
                redirectUri: interaction.redirectUri,
                scope: interaction.scope,
                nonce: interaction.nonce,
                codeChallenge: interaction.codeChallenge,
                authTime: session?.createdAt ?? new Date(),
                expiresAt: new Date(Date.now() + CODE_TTL_MS),
            },
        });

        return { redirectTo: back({ code }) };
    }

    // POST /oauth/token
    async token(params: Params, authorization: string | undefined, context: RequestContext): Promise<TokenResponse> {
        const basic = this.parseBasicAuth(authorization);
        const bodyClientId = stringParam(params, 'client_id');
        if (basic && bodyClientId && bodyClientId !== basic.clientId) {
            throw invalidRequest('client_id does not match the authenticated client');
        }

        const client = await this.clients.authenticate(
            basic?.clientId ?? bodyClientId,
            basic?.clientSecret ?? stringParam(params, 'client_secret')
        );

        switch (stringParam(params, 'grant_type')) {
            case 'authorization_code':
                return this.exchangeCode(client, params, context);
            case 'refresh_token':
                return this.refresh(client, params, context);
            default:
                throw new OAuthError('unsupported_grant_type', 'Supported grants: authorization_code, refresh_token');
        }
    }

    private async exchangeCode(client: OAuthClient, params: Params, context: RequestContext): Promise<TokenResponse> {
        const code = stringParam(params, 'code');
        const verifier = stringParam(params, 'code_verifier');
        if (!code || !verifier) throw invalidRequest('code and code_verifier are required');

        const record = await this.db.authorizationCode.findUnique({ where: { codeHash: sha256(code) } });
        if (!record || record.clientId !== client.id) throw invalidGrant('Invalid authorization code');

        // A code used twice was probably intercepted: revoke what the first use produced (RFC 6749 10.5)
        if (record.usedAt) {
            if (record.sessionId) await this.sessions.revoke(record.sessionId);
            throw invalidGrant('Authorization code was already used');
        }
        if (record.expiresAt < new Date()) throw invalidGrant('Authorization code expired');
        if (stringParam(params, 'redirect_uri') !== record.redirectUri) throw invalidGrant('redirect_uri does not match');
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier) || !safeEqual(pkceChallenge(verifier), record.codeChallenge)) {
            throw invalidGrant('PKCE verification failed');
        }

        const { count } = await this.db.authorizationCode.updateMany({
            where: { id: record.id, usedAt: null },
            data: { usedAt: new Date() },
        });
        if (count !== 1) throw invalidGrant('Authorization code was already used');

        const user = await this.db.user.findUniqueOrThrow({ where: { id: record.userId } });
        const { sessionId, refreshToken } = await this.sessions.create(user.id, context, {
            clientId: client.id,
            scope: record.scope,
        });
        await this.db.authorizationCode.update({ where: { id: record.id }, data: { sessionId } });

        return this.issueTokens(user, client, {
            sessionId,
            scope: record.scope,
            nonce: record.nonce ?? undefined,
            authTime: record.authTime,
            refreshToken,
        });
    }

    private async refresh(client: OAuthClient, params: Params, context: RequestContext): Promise<TokenResponse> {
        const refreshToken = stringParam(params, 'refresh_token');
        if (!refreshToken) throw invalidRequest('refresh_token is required');

        // Checked before rotating so another client's token isn't burned
        const sessionId = refreshToken.split('.')[0];
        const owner = await this.db.session.findUnique({ where: { id: sessionId }, select: { clientId: true } });
        if (owner?.clientId !== client.id) throw invalidGrant('Invalid refresh token');

        let rotated;
        try {
            rotated = await this.sessions.rotate(refreshToken, context);
        } catch (error) {
            if (error instanceof UnauthorizedError) throw invalidGrant(error.message);
            throw error;
        }

        const { session } = rotated;
        return this.issueTokens(session.user, client, {
            sessionId: session.id,
            scope: session.scope ?? 'openid',
            authTime: session.createdAt,
            refreshToken: rotated.refreshToken,
        });
    }

    private async issueTokens(
        user: User,
        client: OAuthClient,
        grant: { sessionId: string; scope: string; nonce?: string; authTime: Date; refreshToken: string }
    ): Promise<TokenResponse> {
        const scopes = grant.scope.split(' ');
        const accessToken = await this.accessTokens.sign({
            userId: user.id,
            role: user.role,
            sessionId: grant.sessionId,
            clientId: client.id,
            scope: grant.scope,
        });

        return {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: Math.floor(durationToMs(env.ACCESS_TOKEN_TTL) / 1000),
            scope: grant.scope,
            id_token: await this.signIdToken(user, client, scopes, grant.nonce, grant.authTime),
            // Long-lived access only when the client asked for it
            ...(scopes.includes('offline_access') && { refresh_token: grant.refreshToken }),
        };
    }

    private async signIdToken(user: User, client: OAuthClient, scopes: string[], nonce: string | undefined, authTime: Date) {
        const { kid, privateKey } = await this.signingKeys.signingKey();
        return jwt.sign(
            {
                ...this.claimsFor(user, scopes),
                auth_time: Math.floor(authTime.getTime() / 1000),
                ...(nonce && { nonce }),
            },
            privateKey,
            {
                algorithm: 'ES256',
                keyid: kid,
                issuer: env.OIDC_ISSUER,
                audience: client.id,
                subject: user.id,
                expiresIn: ID_TOKEN_TTL,
            }
        );
    }

    // GET/POST /oauth/userinfo with an access token issued to a client
    async userinfo(authorization: string | undefined) {
        const [scheme, token] = authorization?.split(' ') ?? [];
        if (scheme !== 'Bearer' || !token) throw new OAuthError('invalid_token', 'Missing bearer token', 401);

        const audience = (jwt.decode(token) as jwt.JwtPayload | null)?.client_id;
        if (typeof audience !== 'string') throw new OAuthError('invalid_token', 'Not a client access token', 401);

        let claims;
        try {
            claims = await this.accessTokens.verify(token, audience);
        } catch {
            throw new OAuthError('invalid_token', 'Invalid or expired access token', 401);
        }
        if (!(await this.sessions.isActive(claims.sessionId))) {
            throw new OAuthError('invalid_token', 'The session has ended', 401);
        }

        const scopes = (claims.scope ?? '').split(' ');
        if (!scopes.includes('openid')) throw new OAuthError('insufficient_scope', 'The openid scope is required', 403);

        const user = await this.db.user.findUnique({ where: { id: claims.userId } });
        if (!user) throw new OAuthError('invalid_token', 'Unknown user', 401);
        return { sub: user.id, ...this.claimsFor(user, scopes) };
    }

    discovery() {
        const base = env.OIDC_ISSUER.replace(/\/$/, '');
        return {
            issuer: env.OIDC_ISSUER,
            authorization_endpoint: `${base}/oauth/authorize`,
            token_endpoint: `${base}/oauth/token`,
            userinfo_endpoint: `${base}/oauth/userinfo`,
            jwks_uri: `${base}/.well-known/jwks.json`,
            response_types_supported: ['code'],
            response_modes_supported: ['query'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            subject_types_supported: ['public'],
            id_token_signing_alg_values_supported: ['ES256'],
            scopes_supported: SUPPORTED_SCOPES,
            claims_supported: ['sub', 'iss', 'aud', 'exp', 'iat', 'auth_time', 'nonce', 'email', 'email_verified', 'name', 'given_name', 'family_name', 'updated_at'],
            token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
            code_challenge_methods_supported: ['S256'],
            // RFC 9207: authorization responses carry the issuer, which defeats mix-up attacks
            authorization_response_iss_parameter_supported: true,
        };
    }

    private claimsFor(user: User, scopes: string[]) {
        return {
            ...(scopes.includes('email') && { email: user.email, email_verified: user.isVerified }),
            ...(scopes.includes('profile') && {
                name: `${user.firstName} ${user.lastName}`,
                given_name: user.firstName,
                family_name: user.lastName,
                updated_at: Math.floor(user.updatedAt.getTime() / 1000),
            }),
        };
    }

    private async findInteraction(interactionId: string) {
        const interaction = await this.db.oAuthInteraction.findUnique({
            where: { id: interactionId },
            include: { client: true },
        });
        if (!interaction || interaction.expiresAt < new Date()) {
            throw new NotFoundError('Authorization request not found or expired', 'INTERACTION_NOT_FOUND');
        }
        return interaction;
    }

    // RFC 6749 2.3.1: client id and secret are form-urlencoded before being base64 encoded
    private parseBasicAuth(header: string | undefined) {
        if (!header?.startsWith('Basic ')) return null;
        const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
        const separator = decoded.indexOf(':');
        if (separator < 0) throw invalidRequest('Malformed Basic authorization header');
        try {
            return {
                clientId: decodeURIComponent(decoded.slice(0, separator).replace(/\+/g, ' ')),
                clientSecret: decodeURIComponent(decoded.slice(separator + 1).replace(/\+/g, ' ')),
            };
        } catch {
            throw invalidRequest('Malformed Basic authorization header');
        }
    }
}
