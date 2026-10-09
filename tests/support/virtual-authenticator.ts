import { createHash, generateKeyPairSync, randomBytes, sign, type KeyObject } from 'node:crypto';

// A software WebAuthn authenticator for tests. It produces the same structures a real
// one does (P-256 key, COSE key, authenticator data, "none" attestation, ES256
// signatures), so the server's real verification code runs against it.

type CborValue = number | string | Uint8Array | CborValue[] | Map<CborValue, CborValue>;

// Just enough CBOR (RFC 8949) for WebAuthn structures
const cborHeader = (major: number, length: number): Buffer => {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 0x100) return Buffer.from([(major << 5) | 24, length]);
    if (length < 0x10000) return Buffer.from([(major << 5) | 25, length >> 8, length & 0xff]);
    const header = Buffer.alloc(5);
    header[0] = (major << 5) | 26;
    header.writeUInt32BE(length, 1);
    return header;
};

const cbor = (value: CborValue): Buffer => {
    if (typeof value === 'number') return value >= 0 ? cborHeader(0, value) : cborHeader(1, -1 - value);
    if (typeof value === 'string') {
        const bytes = Buffer.from(value, 'utf8');
        return Buffer.concat([cborHeader(3, bytes.length), bytes]);
    }
    if (value instanceof Uint8Array) return Buffer.concat([cborHeader(2, value.length), Buffer.from(value)]);
    if (Array.isArray(value)) return Buffer.concat([cborHeader(4, value.length), ...value.map(cbor)]);
    return Buffer.concat([cborHeader(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
};

const b64url = (data: Uint8Array | string) => Buffer.from(data).toString('base64url');
const sha256 = (data: Uint8Array | string) => createHash('sha256').update(data).digest();

const FLAG_USER_PRESENT = 0x01;
const FLAG_USER_VERIFIED = 0x04;
const FLAG_BACKUP_ELIGIBLE = 0x08;
const FLAG_BACKED_UP = 0x10;
const FLAG_ATTESTED_CREDENTIAL = 0x40;

interface CeremonyOptions {
    origin?: string;
    // Simulate an authenticator that skipped biometrics/PIN
    userVerified?: boolean;
}

export class VirtualAuthenticator {
    readonly credentialId = randomBytes(32);
    private readonly privateKey: KeyObject;
    private readonly publicKey: KeyObject;
    private userHandle = new Uint8Array();
    signCount = 0;

    // synced: behaves like a passkey in iCloud Keychain or Google Password Manager,
    // which is backed up and always reports a signature counter of 0
    constructor(
        private readonly synced = false,
        private readonly rpId = 'localhost',
        private readonly origin = 'http://localhost:3000'
    ) {
        ({ privateKey: this.privateKey, publicKey: this.publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' }));
    }

    get id(): string {
        return b64url(this.credentialId);
    }

    // A copy with the same key and counter, like an extracted or cloned authenticator
    clone(): VirtualAuthenticator {
        const copy = Object.create(VirtualAuthenticator.prototype) as VirtualAuthenticator;
        return Object.assign(copy, this);
    }

    private coseKey(): Buffer {
        const jwk = this.publicKey.export({ format: 'jwk' });
        return cbor(
            new Map<CborValue, CborValue>([
                [1, 2], // kty: EC2
                [3, -7], // alg: ES256
                [-1, 1], // crv: P-256
                [-2, Buffer.from(jwk.x!, 'base64url')],
                [-3, Buffer.from(jwk.y!, 'base64url')],
            ])
        );
    }

    private authenticatorData(flags: number, attestedCredential?: Buffer): Buffer {
        const counter = Buffer.alloc(4);
        counter.writeUInt32BE(this.signCount);
        return Buffer.concat([sha256(this.rpId), Buffer.from([flags]), counter, ...(attestedCredential ? [attestedCredential] : [])]);
    }

    private flags(userVerified: boolean) {
        return (
            FLAG_USER_PRESENT |
            (userVerified ? FLAG_USER_VERIFIED : 0) |
            (this.synced ? FLAG_BACKUP_ELIGIBLE | FLAG_BACKED_UP : 0)
        );
    }

    private clientData(type: string, challenge: string, origin: string) {
        return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }));
    }

    // navigator.credentials.create()
    createCredential(
        options: { challenge: string; user: { id: string } },
        { origin = this.origin, userVerified = true }: CeremonyOptions = {}
    ) {
        this.userHandle = Buffer.from(options.user.id, 'base64url');

        const idLength = Buffer.alloc(2);
        idLength.writeUInt16BE(this.credentialId.length);
        const attestedCredential = Buffer.concat([Buffer.alloc(16), idLength, this.credentialId, this.coseKey()]);
        const authData = this.authenticatorData(this.flags(userVerified) | FLAG_ATTESTED_CREDENTIAL, attestedCredential);

        const attestationObject = cbor(
            new Map<CborValue, CborValue>([
                ['fmt', 'none'],
                ['attStmt', new Map()],
                ['authData', authData],
            ])
        );

        return {
            id: this.id,
            rawId: this.id,
            type: 'public-key' as const,
            response: {
                clientDataJSON: b64url(this.clientData('webauthn.create', options.challenge, origin)),
                attestationObject: b64url(attestationObject),
                transports: ['internal'],
            },
            clientExtensionResults: {},
            authenticatorAttachment: 'platform' as const,
        };
    }

    // navigator.credentials.get()
    getAssertion(options: { challenge: string }, { origin = this.origin, userVerified = true }: CeremonyOptions = {}) {
        if (!this.synced) this.signCount += 1;
        const authData = this.authenticatorData(this.flags(userVerified));
        const clientDataJSON = this.clientData('webauthn.get', options.challenge, origin);
        const signature = sign('sha256', Buffer.concat([authData, sha256(clientDataJSON)]), this.privateKey);

        return {
            id: this.id,
            rawId: this.id,
            type: 'public-key' as const,
            response: {
                clientDataJSON: b64url(clientDataJSON),
                authenticatorData: b64url(authData),
                signature: b64url(signature),
                // Absent when the authenticator never registered with this site
                ...(this.userHandle.length > 0 && { userHandle: b64url(this.userHandle) }),
            },
            clientExtensionResults: {},
            authenticatorAttachment: 'platform' as const,
        };
    }
}
