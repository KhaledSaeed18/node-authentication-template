# Changelog

## Unreleased

### Breaking changes

- Access tokens are signed with ES256 instead of HS256. `JWT_SECRET` is no longer used and can be removed. Access tokens issued before the upgrade stop working; clients get a new one through `POST /auth/refresh-token` (refresh tokens are unaffected).

### Added

- OpenTelemetry: traces for HTTP, Express, Prisma and SQL, business metrics, trace ids in logs; enabled with `OTEL_EXPORTER_OTLP_ENDPOINT`. `compose.observability.yaml` adds a Grafana stack.
- Account activity log (`GET /users/me/activity`, and `GET /users/:userId/activity` for admins) recording security-relevant changes, plus email alerts for sign-ins from a new browser/OS, account lockouts, refresh token reuse and recovery code use. New setting `SECURITY_EVENT_RETENTION_DAYS`.
- Security automation: CodeQL, a container build that is smoke tested and scanned with Trivy (with an SBOM), dependency review on pull requests. The runtime image no longer contains npm or yarn.
- ES256 signing keys stored encrypted in the database, rotated automatically (`SIGNING_KEY_ROTATION_DAYS`), and published at `/.well-known/jwks.json` so other services can verify access tokens.

- Passkeys (WebAuthn): usernameless passwordless sign-in, registration and management (list, rename, remove). New settings `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS`.
- Transactional outbox: emails and security notices are written as jobs in the same database transaction as the change that triggers them, then delivered by a worker with retries and exponential backoff. The worker runs inside the API (`OUTBOX_WORKER_ENABLED`) or separately (`node dist/scripts/worker.js`).
- Community files: code of conduct, security policy with private vulnerability reporting, support guide, issue forms and a detailed contributing guide.

### Changed

- Run `yarn db:deploy` for the new `OutboxMessage`, `Passkey`, `WebAuthnChallenge`, `SigningKey` and `SecurityEvent` tables.
- `forgot-password` and `resend-verification` now enqueue a job instead of sending directly.

## 2.0.0

A full rework: dependencies brought up to date, the code reorganized into modules, and many security issues fixed. Several API and configuration changes are breaking.

### Breaking changes

**Environment variables**

- New, required: `ENCRYPTION_KEY` (32 random bytes, base64: `openssl rand -base64 32`).
- Removed: `JWT_REFRESH_SECRET` (refresh tokens are no longer JWTs), `SALT_ROUNDS` (Argon2id replaces bcrypt), `REDIRECT_URI`.
- Renamed: `USER_EMAIL`, `CLIENT_ID`, `CLIENT_SECRET`, `REFRESH_TOKEN` are now `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`, and only used with `MAIL_TRANSPORT=gmail`. The default transport is `console`.
- `JWT_SECRET` must be at least 32 characters. All variables are validated at startup.
- CORS origins move from code to `CORS_ORIGINS`.

**API**

- `POST /auth/refresh-token` returns a new `refreshToken` together with the `accessToken`. The previous refresh token stops working; reusing it later revokes the session.
- `POST /auth/signin` with 2FA enabled returns `{ requiresTwoFactor: true, mfaToken }` (was `status: "pending"` with `requiresOtp`).
- `POST /auth/2fa/signin` takes `{ mfaToken, code }` (was `{ email, password, token }`).
- `POST /auth/2fa/verify` and `/auth/2fa/disable` take `code` instead of `token`. Verify now returns recovery codes.
- `forgot-password` and `resend-verification` always return 200; `verify-email` and `reset-password` return `INVALID_CODE` for unknown emails instead of 404.
- A missing access token returns 401 (was 403).
- Error responses include a `code` field and no longer leak internal details.
- `GET /auth/login-history` is paginated (`?limit=&cursor=`) and returns `nextCursor`.
- Request bodies are no longer passed through an HTML sanitizer, which used to alter passwords containing `<` or `>`.

**Database**

- Run the new migrations (`yarn db:deploy`). Codes move from the `User` table to `VerificationCode`; codes that were pending during the upgrade have to be requested again.
- Existing emails are lowercased. The migration fails on purpose if two accounts only differ by case.
- Existing bcrypt password hashes keep working and are upgraded to Argon2id on the next sign in. Existing plaintext 2FA secrets keep working and are encrypted on first use.

**Tooling**

- Node.js 24+ and native ES modules. The Prisma client is generated into `src/generated/prisma`.

### Added

- Server-side sessions with rotating refresh tokens and reuse detection
- Logout, logout everywhere, session list and revoke
- Change password endpoint; password changes end other sessions
- 2FA recovery codes; 2FA secrets encrypted at rest; TOTP replay protection
- Account lockout, constant-time sign in rejection, no account enumeration
- Hashed, single-use verification codes with attempt limits and a resend cooldown
- Security notification emails
- `/users/me` profile endpoints and an admin-only user list
- Health and readiness probes, graceful shutdown
- Structured logging with request ids
- Optional Redis store for rate limits
- OpenAPI document and API reference at `/docs`
- Data retention cleanup job
- SMTP / Gmail / console mail transports
- Docker image, Compose stack, CI, Dependabot, integration tests

### Fixed

- Login history returned every user's sign-ins
- An invalid or expired refresh token returned 500
- Malformed signup emails crashed validation
- Validation results were discarded, so inputs were never trimmed
- Tablets were reported as mobile devices
- Names with accents, apostrophes, hyphens or non-Latin scripts were rejected

## 1.0.0

Initial release.
