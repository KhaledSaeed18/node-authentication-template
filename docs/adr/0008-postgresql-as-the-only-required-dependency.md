# 0008. PostgreSQL as the only required dependency

**Status:** Accepted

## Context

Features like rate limiting, background jobs, key distribution and session revocation are often built on extra infrastructure (Redis, a message broker, a key management service). Each one adds operations work, failure modes and cost, which matters for a template meant to be easy to adopt.

## Decision

- PostgreSQL is the only required service. Sessions, codes, keys, the outbox, WebAuthn challenges and the activity log all live there.
- Redis is optional and used for one thing: sharing rate limit counters between instances (`REDIS_URL`). Without it, counters are per process.
- Concurrency control relies on PostgreSQL features: conditional updates for single-use values, `FOR UPDATE SKIP LOCKED` for the outbox, advisory locks for key rotation.

## Consequences

- A single-instance deployment needs nothing but Node.js and PostgreSQL; the Compose stack adds Redis and Mailpit for convenience.
- PostgreSQL carries some write load that a specialized store would otherwise take (outbox polling, sessions). Indexes cover every hot query, and the cleanup job keeps the tables small.
- If a component outgrows PostgreSQL, the boundaries are already in place to move it (for example the outbox handlers to a broker).
