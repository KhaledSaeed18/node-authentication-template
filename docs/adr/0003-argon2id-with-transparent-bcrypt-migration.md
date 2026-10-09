# 0003. Argon2id with transparent migration from bcrypt

**Status:** Accepted

## Context

Passwords were hashed with bcrypt (`bcryptjs`, cost 10). OWASP recommends Argon2id, which is memory-hard and much more expensive to attack with GPUs. Existing users must not be forced to reset their password.

## Decision

- Hash new passwords with Argon2id, 19 MiB memory, 2 iterations, parallelism 1 (OWASP's baseline), through `@node-rs/argon2` (prebuilt binaries, no compiler needed).
- When a user signs in with a bcrypt hash (or an Argon2 hash with older parameters), verify it with the matching algorithm and replace it with a fresh Argon2id hash.
- Unknown emails are verified against a dummy Argon2id hash, and run the same lockout queries, so a missing account takes as long to reject as a wrong password.

## Alternatives considered

- **Keep bcrypt**: acceptable, but weaker against dedicated hardware and limited to 72 bytes of input.
- **scrypt from `node:crypto`**: no native dependency, but Argon2id is the current first recommendation.
- **Rehash everything at once**: impossible, the plaintext passwords are not known.

## Consequences

- About 20 ms of CPU per hash; the rate limits and the lockout keep that from becoming a denial of service vector.
- Raising the parameters later upgrades users gradually on their next sign-in.
- `bcryptjs` stays as a dependency until no bcrypt hashes remain.
