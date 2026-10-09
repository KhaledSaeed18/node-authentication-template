# 0004. One master key with HKDF-derived subkeys

**Status:** Accepted

## Context

Several things need to be protected at rest with a server-side key: email codes and recovery codes (keyed hashes), TOTP secrets and the private signing keys (encryption), and the 2FA challenge token (signature). Separate secrets for each would make configuration error-prone; reusing one key for several algorithms is bad practice.

## Decision

- A single `ENCRYPTION_KEY` (32 random bytes) is configured.
- Each use gets its own key derived with HKDF-SHA256 and a purpose label (`verification-code`, `recovery-code`, `totp-secret`, `signing-key`, `mfa-token`).
- Short codes are stored as HMAC-SHA256 with the derived key, never as plain hashes: a 6-digit code has only a million possible values, so a plain hash could be reversed from a database dump in milliseconds.
- Encrypted values use AES-256-GCM with a random IV and a version prefix (`v1:`), so the format can evolve.

## Alternatives considered

- **One environment variable per purpose**: more to configure and rotate, with no security gain since they would live in the same place.
- **A KMS** (AWS KMS, Vault): the right step for larger deployments; the `encrypt`/`decrypt` helpers are the place to plug it in.

## Consequences

- Changing `ENCRYPTION_KEY` invalidates outstanding codes and makes TOTP secrets and signing keys unreadable. A signing key that can't be decrypted makes the instance fail closed and report not ready instead of silently generating a new key ([0006](0006-es256-access-tokens-with-jwks-and-rotation.md)).
- Key rotation for `ENCRYPTION_KEY` itself would need a re-encryption job; it is not implemented yet.
