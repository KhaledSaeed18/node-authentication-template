import type { OAuthClient, PrismaClient } from '../../generated/prisma/client.js';
import { NotFoundError } from '../../shared/errors/app-error.js';
import { randomToken, safeEqual, sha256 } from '../../shared/utils/crypto.js';
import { invalidClient } from './oidc.errors.js';
import type { CreateClientInput } from './oidc.schemas.js';

export type PublicClient = Omit<OAuthClient, 'secretHash'> & { confidential: boolean };

const toPublicClient = ({ secretHash, ...client }: OAuthClient): PublicClient => ({ ...client, confidential: !!secretHash });

// Registered OpenID Connect clients
export class ClientService {
    constructor(private readonly db: PrismaClient) {}

    // The secret is returned once; only its hash is stored (it's 256 random bits, so a
    // plain SHA-256 is enough)
    async create(input: CreateClientInput): Promise<{ client: PublicClient; clientSecret?: string }> {
        const clientSecret = input.confidential ? randomToken(32) : undefined;
        const client = await this.db.oAuthClient.create({
            data: {
                id: randomToken(16),
                name: input.name,
                redirectUris: input.redirectUris,
                scopes: input.scopes,
                firstParty: input.firstParty,
                secretHash: clientSecret ? sha256(clientSecret) : null,
            },
        });
        return { client: toPublicClient(client), ...(clientSecret && { clientSecret }) };
    }

    async list(): Promise<PublicClient[]> {
        const clients = await this.db.oAuthClient.findMany({ orderBy: { createdAt: 'desc' } });
        return clients.map(toPublicClient);
    }

    async remove(clientId: string): Promise<void> {
        const { count } = await this.db.oAuthClient.deleteMany({ where: { id: clientId } });
        if (count === 0) throw new NotFoundError('Client not found', 'CLIENT_NOT_FOUND');
    }

    async find(clientId: string): Promise<OAuthClient | null> {
        return this.db.oAuthClient.findUnique({ where: { id: clientId } });
    }

    // Token endpoint authentication: client_secret_basic, client_secret_post, or none for
    // public clients (which must then prove possession of the PKCE verifier)
    async authenticate(clientId: string | undefined, clientSecret: string | undefined): Promise<OAuthClient> {
        if (!clientId) throw invalidClient();
        const client = await this.find(clientId);
        if (!client) throw invalidClient();

        if (client.secretHash) {
            if (!clientSecret || !safeEqual(sha256(clientSecret), client.secretHash)) throw invalidClient();
        } else if (clientSecret) {
            // A public client has no secret; sending one means something is misconfigured
            throw invalidClient();
        }
        return client;
    }
}
