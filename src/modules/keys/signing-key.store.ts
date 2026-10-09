import { createPrivateKey, createPublicKey, generateKeyPairSync, type JsonWebKey, type KeyObject } from 'node:crypto';
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js';
import { logger } from '../../lib/logger.js';
import { decrypt, deriveKey, encrypt, randomToken } from '../../shared/utils/crypto.js';

const ALGORITHM = 'ES256';
const CACHE_TTL_MS = 60 * 1000;
// A token with an unknown kid triggers a reload (a key created by another instance),
// but not more often than this, so garbage kids can't hammer the database
const MIN_RELOAD_INTERVAL_MS = 5 * 1000;
// Arbitrary constant identifying the rotation lock (pg_advisory_xact_lock)
const ROTATION_LOCK_ID = 7_210_431;

const privateKeyEncryptionKey = deriveKey('signing-key');

export interface SigningKeyStoreOptions {
    // Rotate once the active key is older than this
    rotationIntervalMs: number;
    // Keep retired keys published this long, so tokens they signed stay verifiable
    retiredKeyRetentionMs: number;
}

interface LoadedKey {
    kid: string;
    publicKey: KeyObject;
    publicJwk: JsonWebKey;
    createdAt: Date;
    // Only for keys that may still sign (not retired)
    privateKey?: KeyObject;
}

// Loads, caches, rotates and publishes the access token signing keys
export class SigningKeyStore {
    private keys: LoadedKey[] = [];
    private loadedAt = 0;
    private lastForcedReload = 0;
    private loading: Promise<void> | undefined;

    constructor(
        private readonly db: PrismaClient,
        private readonly options: SigningKeyStoreOptions
    ) {}

    // Key used to sign new tokens: the newest active one, rotating first if it's too old
    async signingKey(): Promise<{ kid: string; privateKey: KeyObject }> {
        await this.ensureLoaded();
        let current = this.newestActive();

        if (!current || Date.now() - current.createdAt.getTime() > this.options.rotationIntervalMs) {
            await this.rotate();
            await this.ensureLoaded(true);
            current = this.newestActive();
        }
        if (!current?.privateKey) throw new Error('No signing key available');

        return { kid: current.kid, privateKey: current.privateKey };
    }

    // Public key for a kid found in a token header, or null if it isn't (or no longer) ours
    async publicKey(kid: string): Promise<KeyObject | null> {
        await this.ensureLoaded();
        let key = this.keys.find((k) => k.kid === kid);

        if (!key && Date.now() - this.lastForcedReload > MIN_RELOAD_INTERVAL_MS) {
            this.lastForcedReload = Date.now();
            await this.ensureLoaded(true);
            key = this.keys.find((k) => k.kid === kid);
        }
        return key?.publicKey ?? null;
    }

    // JSON Web Key Set served at /.well-known/jwks.json
    async jwks(): Promise<{ keys: (JsonWebKey & { kid: string; alg: string; use: string })[] }> {
        await this.ensureLoaded();
        if (this.keys.length === 0) await this.signingKey();
        return { keys: this.keys.map((k) => ({ ...k.publicJwk, kid: k.kid, alg: ALGORITHM, use: 'sig' })) };
    }

    // Creates a new key and retires the previous ones. Unless forced, it does nothing if
    // another instance rotated in the meantime. An advisory lock keeps instances from
    // rotating at the same time.
    async rotate({ force = false }: { force?: boolean } = {}): Promise<string | null> {
        const kid = await this.db.$transaction(async (tx) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ROTATION_LOCK_ID})`;

            const newest = await tx.signingKey.findFirst({ where: { retiredAt: null }, orderBy: { createdAt: 'desc' } });
            const fresh = newest && Date.now() - newest.createdAt.getTime() <= this.options.rotationIntervalMs;
            if (fresh && !force) return null;

            const { publicKey, privateKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
            const newKid = randomToken(16);

            await tx.signingKey.updateMany({ where: { retiredAt: null }, data: { retiredAt: new Date() } });
            await tx.signingKey.create({
                data: {
                    id: newKid,
                    algorithm: ALGORITHM,
                    publicJwk: publicKey.export({ format: 'jwk' }) as Prisma.InputJsonValue,
                    privateKey: encrypt(privateKeyEncryptionKey, privateKey.export({ format: 'pem', type: 'pkcs8' }).toString()),
                },
            });
            return newKid;
        });

        if (kid) {
            logger.info({ kid }, 'Signing key rotated');
            await this.ensureLoaded(true);
        }
        return kid;
    }

    private newestActive(): LoadedKey | undefined {
        return this.keys.find((k) => k.privateKey);
    }

    private async ensureLoaded(force = false) {
        if (!force && Date.now() - this.loadedAt < CACHE_TTL_MS) return;
        // Concurrent callers share one load
        this.loading ??= this.load().finally(() => {
            this.loading = undefined;
        });
        await this.loading;
    }

    private async load() {
        const retiredSince = new Date(Date.now() - this.options.retiredKeyRetentionMs);
        const rows = await this.db.signingKey.findMany({
            where: { OR: [{ retiredAt: null }, { retiredAt: { gt: retiredSince } }] },
            orderBy: { createdAt: 'desc' },
        });

        this.keys = rows.map((row) => ({
            kid: row.id,
            publicJwk: row.publicJwk as JsonWebKey,
            publicKey: createPublicKey({ key: row.publicJwk as JsonWebKey, format: 'jwk' }),
            createdAt: row.createdAt,
            // Retired keys only verify, so their private key is never decrypted
            ...(!row.retiredAt && { privateKey: this.openPrivateKey(row.id, row.privateKey) }),
        }));
        this.loadedAt = Date.now();
    }

    // Fails closed: generating a replacement key here would let one misconfigured
    // instance retire the keys every other instance is using
    private openPrivateKey(kid: string, encrypted: string): KeyObject {
        try {
            return createPrivateKey(decrypt(privateKeyEncryptionKey, encrypted));
        } catch (error) {
            throw new Error(`Cannot decrypt signing key ${kid}. Was ENCRYPTION_KEY changed?`, { cause: error });
        }
    }
}
