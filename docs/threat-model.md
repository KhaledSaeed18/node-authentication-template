# Threat Model

A STRIDE analysis of the authentication service. Each threat lists the mitigation in place and where it is tested, followed by the risks that remain. Found something missing? Please report it through the [security policy](../SECURITY.md).

## Assets

| Asset | Where it lives | Protection at rest |
| --- | --- | --- |
| Passwords | `User.password` | Argon2id hash |
| Email verification and reset codes | `VerificationCode` | HMAC-SHA256 with a derived key |
| 2FA recovery codes | `RecoveryCode` | HMAC-SHA256 with a derived key |
| TOTP secrets | `User.totpSecret` | AES-256-GCM |
| Refresh tokens | `Session.tokenHash` | SHA-256 of a 256-bit random value |
| Access token signing keys | `SigningKey.privateKey` | AES-256-GCM |
| Passkey public keys | `Passkey` | Public data, integrity matters |
| `ENCRYPTION_KEY` | Environment | Outside the database |
| Personal data (name, email, IPs, user agents) | `User`, `LoginHistory`, `SecurityEvent` | Retention limits via the cleanup job |

## Trust boundaries

1. **Internet to API**: every request is untrusted. Validated with Zod, size limited (10 kb), rate limited, security headers set by helmet.
2. **API to PostgreSQL**: trusted network, but a database leak is assumed possible: nothing in the database is enough on its own to sign in or to sign tokens.
3. **API to mail provider**: emails can be read by the provider and by anyone with access to the inbox; they only contain short-lived codes.
4. **Other services to JWKS**: public keys only.

## STRIDE

### Spoofing

| Threat | Mitigation | Tests |
| --- | --- | --- |
| Password guessing on one account | Lockout after 5 failures in 15 min, owner emailed; per-IP rate limits | `signin-protection`, `activity` |
| Credential stuffing across many accounts | Per-IP rate limits, optionally shared through Redis; 2FA and passkeys | `signin-protection` |
| Guessing email or reset codes | HMAC-stored, 5 attempts per code (claimed atomically, so parallel guesses don't get more), 15 min expiry, single use | `verification-codes` |
| Forged access tokens | ES256 with pinned algorithm, key resolved by `kid`, issuer and audience checked; rejects `alg: none` and HS256 signed with the public key | `tokens` |
| Stolen refresh token | Rotation on every use; reuse revokes the session and alerts the owner | `sessions`, `activity` |
| Replayed TOTP code | Last accepted time step stored, older or equal steps rejected (atomic) | `auth` |
| Skipping the password step of 2FA | Second step requires a 5-minute challenge token signed with its own key | `auth` |
| Phishing | Passkeys are bound to the origin and RP id; wrong origin rejected | `passkeys` |
| Replayed or cloned passkey | Single-use server-side challenges; signature counter regression rejected | `passkeys` |

### Tampering

| Threat | Mitigation | Tests |
| --- | --- | --- |
| Modified token claims (e.g. role) | Signature verification | `tokens` |
| Mass assignment (setting `role` or `email` through profile updates) | Zod schemas strip unknown fields; only names are updatable | `users` |
| Tampered encrypted values | AES-GCM authentication tag | `tokens` (misconfiguration case) |
| Race conditions on single-use values | Conditional updates (`updateMany` with the expected state), `FOR UPDATE SKIP LOCKED`, advisory lock for key rotation | `verification-codes`, `outbox`, `tokens` |

### Repudiation

| Threat | Mitigation | Tests |
| --- | --- | --- |
| "I didn't change my password / turn off 2FA" | Account activity log with time, IP and device, written in the same transaction as the change | `activity` |
| Untraceable requests | Structured logs with a request id (returned as `X-Request-Id`) | manual |

### Information disclosure

| Threat | Mitigation | Tests |
| --- | --- | --- |
| Account enumeration through responses | Identical answers for unknown emails on forgot-password, resend-verification, verify-email and reset-password | `verification-codes` |
| Account enumeration through timing | Unknown emails run the same lockout queries and a dummy Argon2id check; email-sending endpoints only enqueue a job | `signin-protection` |
| Database leak | Hashes, HMACs and encryption as listed under assets | `verification-codes`, `sessions`, `auth`, `tokens` |
| Secrets in logs | pino redaction of authorization headers, passwords, tokens; no secrets in outbox payloads | manual |
| Internal errors leaking | Central error handler: generic 500 to clients, details only in logs; stack traces only in development | manual |
| Other users' data (IDOR) | Every query on user data is filtered by the authenticated user id; admin routes require the ADMIN role | `auth`, `sessions`, `passkeys`, `users`, `activity` |

### Denial of service

| Threat | Mitigation | Tests |
| --- | --- | --- |
| Request flooding | Rate limits on every route, 10 kb body limit | manual (rate limits are disabled in the test suite; shared Redis limits verified with two instances) |
| CPU exhaustion through password hashing | Rate limits and lockout bound the number of hashes per IP and account | `signin-protection` |
| Email bombing | 60 s cooldown per code, rate limits on resend and forgot-password | `verification-codes` |
| Unbounded tables | Cleanup job for sessions, codes, challenges, jobs, old keys, login history and activity | `cleanup` |
| Locking a victim out with failed passwords | Lockout is temporary (15 min); passkey sign-in isn't affected by it | `signin-protection`, `passkeys` |

### Elevation of privilege

| Threat | Mitigation | Tests |
| --- | --- | --- |
| Reaching admin routes | `requireRole('ADMIN')`; role read from the token, which is re-issued with the current role on refresh | `users` |
| Keeping access after a password change | Password reset ends all sessions, password change all others; revocation is immediate | `sessions` |
| Minting tokens from a verifier service | Verifiers only get public keys | `tokens` |

## Residual risks

- **Signup reveals registered emails** (409 on a taken email). A deliberate usability tradeoff, rate limited. Fully closing it needs an "account exists" email instead of an error.
- **Revocation is not visible to third-party verifiers**: services that verify tokens with the JWKS accept a revoked session's token until it expires (15 minutes by default).
- **Rate limits are per process without Redis.** Multi-instance deployments should set `REDIS_URL`.
- **Lockout can be triggered by an attacker** to annoy a user for 15 minutes (mitigated by passkeys, but not removed).
- **`ENCRYPTION_KEY` is a single point of failure** for data at rest, and rotating it is not automated.
- **TOTP and email codes are phishable** in real time; only passkeys resist phishing.
- **Dependencies**: the Prisma CLI pins `deepmerge-ts` 7.x with a known high-severity advisory (only reachable through Prisma's own config loading). Tracked by Trivy and Dependabot.
- **No breached-password check** (e.g. Have I Been Pwned); only a small list of common passwords is rejected.

## Out of scope

Compromise of the host, the database server or the CI pipeline; client-side storage of tokens; the mail provider's security.
