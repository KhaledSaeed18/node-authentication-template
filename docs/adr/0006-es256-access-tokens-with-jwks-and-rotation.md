# 0006. ES256 access tokens with JWKS and key rotation

**Status:** Accepted

## Context

Access tokens were HS256 JWTs. Any service that wanted to verify them needed the shared secret, which also allowed it to mint tokens, and the secret was never rotated.

## Decision

- Sign access tokens with ES256. Key pairs live in the `SigningKey` table; private keys are encrypted ([0004](0004-one-master-key-with-derived-subkeys.md)) and every token carries its key id (`kid`).
- Publish the public keys at `/.well-known/jwks.json`, so other services verify tokens without any secret.
- Rotate automatically once the active key is older than `SIGNING_KEY_ROTATION_DAYS`. A Postgres advisory lock lets one instance do it. Retired keys stay published until every token they signed has expired, then the cleanup job deletes them.
- Instances cache the key set and reload (at most every 5 seconds) when they see an unknown `kid`, so a key created by another instance is picked up immediately.
- Verification pins ES256 and resolves the key by `kid`, which rejects unsigned tokens and HS256 tokens "signed" with the public key.
- A key that can't be decrypted makes the instance fail closed and report not ready, rather than generating a replacement: one misconfigured instance must not retire the keys the others use.

## Alternatives considered

- **RS256**: equally standard, but larger keys and signatures.
- **EdDSA (Ed25519)**: excellent, but less widely supported by JWT libraries and API gateways.
- **Keys in environment variables**: manual rotation and no automatic publication of old keys.

## Consequences

- Other services verify tokens offline but do not see session revocations until the token expires.
- This is the base for acting as an OpenID Connect provider later (discovery document, ID tokens).
