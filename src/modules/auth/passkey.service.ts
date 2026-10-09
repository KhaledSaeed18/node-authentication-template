import {
    generateAuthenticationOptions,
    generateRegistrationOptions,
    verifyAuthenticationResponse,
    verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
    AuthenticationResponseJSON,
    AuthenticatorTransport,
    PublicKeyCredentialCreationOptionsJSON,
    PublicKeyCredentialRequestOptionsJSON,
    RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { env } from '../../config/env.js';
import type { Passkey, PrismaClient, User, WebAuthnCeremony } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { BadRequestError, NotFoundError, UnauthorizedError } from '../../shared/errors/app-error.js';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const MAX_PASSKEYS_PER_USER = 10;

export type PublicPasskey = Pick<Passkey, 'id' | 'name' | 'deviceType' | 'backedUp' | 'createdAt' | 'lastUsedAt'>;

const publicPasskeySelect = {
    id: true,
    name: true,
    deviceType: true,
    backedUp: true,
    createdAt: true,
    lastUsedAt: true,
} as const;

// The browser echoes the challenge inside clientDataJSON, which the authenticator signs.
// Reading it from there lets clients send back the standard WebAuthn response as is.
const challengeFrom = (clientDataJSON: string): string | null => {
    try {
        const clientData = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
        return typeof clientData.challenge === 'string' ? clientData.challenge : null;
    } catch {
        return null;
    }
};

const ceremonyFailed = () => new UnauthorizedError('Passkey verification failed', 'PASSKEY_VERIFICATION_FAILED');

// Registration and verification of passkeys (WebAuthn credentials)
export class PasskeyService {
    constructor(private readonly db: PrismaClient) {}

    private async saveChallenge(challenge: string, ceremony: WebAuthnCeremony, userId?: string) {
        await this.db.webAuthnChallenge.create({
            data: { challenge, ceremony, userId, expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS) },
        });
    }

    // Single use: the challenge is deleted as it's checked, so a response can't be replayed
    private async consumeChallenge(clientDataJSON: string, ceremony: WebAuthnCeremony, userId?: string): Promise<string> {
        const challenge = challengeFrom(clientDataJSON);
        if (!challenge) throw ceremonyFailed();

        const { count } = await this.db.webAuthnChallenge.deleteMany({
            where: { challenge, ceremony, expiresAt: { gt: new Date() }, ...(userId && { userId }) },
        });
        if (count !== 1) throw ceremonyFailed();
        return challenge;
    }

    async registrationOptions(user: User): Promise<PublicKeyCredentialCreationOptionsJSON> {
        const existing = await this.db.passkey.findMany({ where: { userId: user.id }, select: { id: true, transports: true } });
        if (existing.length >= MAX_PASSKEYS_PER_USER) {
            throw new BadRequestError(`You can register up to ${MAX_PASSKEYS_PER_USER} passkeys`, 'PASSKEY_LIMIT_REACHED');
        }

        const options = await generateRegistrationOptions({
            rpName: env.APP_NAME,
            rpID: env.WEBAUTHN_RP_ID,
            userID: new TextEncoder().encode(user.id),
            userName: user.email,
            userDisplayName: `${user.firstName} ${user.lastName}`,
            attestationType: 'none',
            // Don't let the same authenticator be registered twice
            excludeCredentials: existing.map(({ id, transports }) => ({
                id,
                transports: transports as AuthenticatorTransport[],
            })),
            // Discoverable credential (usernameless sign-in) with biometrics or PIN
            authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
        });

        await this.saveChallenge(options.challenge, 'REGISTRATION', user.id);
        return options;
    }

    async register(userId: string, response: RegistrationResponseJSON, name: string): Promise<PublicPasskey> {
        const expectedChallenge = await this.consumeChallenge(response.response.clientDataJSON, 'REGISTRATION', userId);

        let verification;
        try {
            verification = await verifyRegistrationResponse({
                response,
                expectedChallenge,
                expectedOrigin: env.WEBAUTHN_ORIGINS,
                expectedRPID: env.WEBAUTHN_RP_ID,
                requireUserVerification: true,
            });
        } catch (error) {
            logger.warn({ err: error, userId }, 'Passkey registration rejected');
            throw ceremonyFailed();
        }
        if (!verification.verified) throw ceremonyFailed();

        const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo;

        return this.db.passkey.create({
            data: {
                id: credential.id,
                userId,
                publicKey: Buffer.from(credential.publicKey),
                counter: BigInt(credential.counter),
                transports: credential.transports ?? [],
                deviceType: credentialDeviceType,
                backedUp: credentialBackedUp,
                name,
            },
            select: publicPasskeySelect,
        });
    }

    async authenticationOptions(): Promise<PublicKeyCredentialRequestOptionsJSON> {
        // No allowCredentials: the browser offers every passkey it has for this site
        const options = await generateAuthenticationOptions({ rpID: env.WEBAUTHN_RP_ID, userVerification: 'required' });
        await this.saveChallenge(options.challenge, 'AUTHENTICATION');
        return options;
    }

    // Verifies a sign-in assertion and returns the user it belongs to
    async authenticate(response: AuthenticationResponseJSON): Promise<User> {
        const expectedChallenge = await this.consumeChallenge(response.response.clientDataJSON, 'AUTHENTICATION');

        const passkey = await this.db.passkey.findUnique({ where: { id: response.id }, include: { user: true } });
        if (!passkey) throw ceremonyFailed();

        let verification;
        try {
            verification = await verifyAuthenticationResponse({
                response,
                expectedChallenge,
                expectedOrigin: env.WEBAUTHN_ORIGINS,
                expectedRPID: env.WEBAUTHN_RP_ID,
                requireUserVerification: true,
                credential: {
                    id: passkey.id,
                    publicKey: new Uint8Array(passkey.publicKey),
                    counter: Number(passkey.counter),
                    transports: passkey.transports as AuthenticatorTransport[],
                },
            });
        } catch (error) {
            // Includes a signature counter that went backwards, which points at a cloned authenticator
            logger.warn({ err: error, passkeyId: passkey.id, userId: passkey.userId }, 'Passkey sign-in rejected');
            throw ceremonyFailed();
        }
        if (!verification.verified) throw ceremonyFailed();

        await this.db.passkey.update({
            where: { id: passkey.id },
            data: {
                counter: BigInt(verification.authenticationInfo.newCounter),
                backedUp: verification.authenticationInfo.credentialBackedUp,
                lastUsedAt: new Date(),
            },
        });

        return passkey.user;
    }

    async list(userId: string): Promise<PublicPasskey[]> {
        return this.db.passkey.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, select: publicPasskeySelect });
    }

    async rename(userId: string, passkeyId: string, name: string): Promise<PublicPasskey> {
        const { count } = await this.db.passkey.updateMany({ where: { id: passkeyId, userId }, data: { name } });
        if (count === 0) throw new NotFoundError('Passkey not found', 'PASSKEY_NOT_FOUND');
        return this.db.passkey.findUniqueOrThrow({ where: { id: passkeyId }, select: publicPasskeySelect });
    }

    async remove(userId: string, passkeyId: string): Promise<void> {
        const { count } = await this.db.passkey.deleteMany({ where: { id: passkeyId, userId } });
        if (count === 0) throw new NotFoundError('Passkey not found', 'PASSKEY_NOT_FOUND');
    }
}
