# Node Authentication Template

A secure, modern authentication API for Node.js, built with TypeScript, Express 5, Prisma 7 and PostgreSQL. It covers the full account lifecycle (signup, email verification, passkeys, password sign in and reset, TOTP two-factor authentication with recovery codes, rotating refresh tokens and session management) and is meant to be dropped into a project or used as the starting point of one.

[![CI](https://github.com/KhaledSaeed18/node-authentication-template/actions/workflows/ci.yml/badge.svg)](https://github.com/KhaledSaeed18/node-authentication-template/actions/workflows/ci.yml)
[![CodeQL](https://github.com/KhaledSaeed18/node-authentication-template/actions/workflows/codeql.yml/badge.svg)](https://github.com/KhaledSaeed18/node-authentication-template/actions/workflows/codeql.yml)
[![Container](https://github.com/KhaledSaeed18/node-authentication-template/actions/workflows/container.yml/badge.svg)](https://github.com/KhaledSaeed18/node-authentication-template/actions/workflows/container.yml)
[![Node.js](https://img.shields.io/badge/Node.js-24-43853D?style=for-the-badge&logo=node.js&logoColor=white)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-007ACC?style=for-the-badge&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Express.js](https://img.shields.io/badge/Express-5-404D59?style=for-the-badge&logo=express&logoColor=white)](https://expressjs.com/)
[![Prisma](https://img.shields.io/badge/Prisma-7-3982CE?style=for-the-badge&logo=Prisma&logoColor=white)](https://www.prisma.io/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-316192?style=for-the-badge&logo=postgresql&logoColor=white)](https://www.postgresql.org/)
[![Zod](https://img.shields.io/badge/Zod-4-3068b7?style=for-the-badge&logo=zod&logoColor=white)](https://zod.dev/)
[![Vitest](https://img.shields.io/badge/Vitest-6E9F18?style=for-the-badge&logo=vitest&logoColor=white)](https://vitest.dev/)
[![Docker](https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white)](https://www.docker.com/)

## Features

**Accounts**

- Signup with email verification (6 digit code)
- Sign in with email and password, case-insensitive emails
- Forgot / reset password, change password
- Profile endpoints and an admin-only user list (role based access control)

**Passkeys**

- Passwordless sign-in with WebAuthn passkeys (Touch ID, Face ID, Windows Hello, Android, security keys, synced passkeys)
- Usernameless: the browser offers the saved passkeys, no email to type
- User verification required, so a passkey sign-in counts as two factors
- Single-use challenges, clone detection with the signature counter, passkey management (list, rename, remove)

**OpenID Connect provider**

- Other apps can offer "Sign in with ..." through this service: authorization code flow with PKCE, ID tokens, userinfo, refresh tokens, discovery
- Confidential and public clients, consent for third-party clients, admin client registration
- Verified with `openid-client`, a certified relying party library

**Two-factor authentication**

- TOTP (Google Authenticator, 1Password, Authy, ...) with QR code setup
- Two-step sign in using a short-lived challenge token
- 10 one-time recovery codes, regenerable
- Secrets encrypted at rest, codes can't be replayed

**Sessions**

- Short-lived ES256 JWT access tokens (15 minutes by default), verifiable by other services through `/.well-known/jwks.json`
- Signing keys rotate automatically; private keys are stored encrypted
- Opaque refresh tokens, rotated on every use, with reuse detection
- Logout, logout everywhere, list and revoke individual sessions
- Revocation is immediate: every request checks that the session is still active
- Paginated login history with IP, user agent and device type

**Security**

- Argon2id password hashing (old bcrypt hashes are upgraded on sign in)
- Account lockout after repeated failed sign-ins, constant-time rejection of unknown emails
- One-time codes stored as HMACs, single use, 5 attempts max, resend cooldown
- No account enumeration on forgot-password, resend-verification, verify-email and reset-password
- Email notifications for password, 2FA and passkey changes, account lockouts, recovery code use and sign-ins from new devices
- Account activity log: every security-relevant change is recorded and visible to the user (and to admins)
- Rate limiting on every endpoint, optionally shared through Redis
- Helmet security headers, strict CORS, request size limits, validated configuration

**Operations**

- Transactional outbox: emails and notices are committed with the change that caused them and delivered by a worker with retries (`FOR UPDATE SKIP LOCKED`, runs in-process or as separate workers)
- OpenTelemetry traces (HTTP, Express, Prisma and SQL) and business metrics (sign-ins by method and result, lockouts, token reuse, outbox throughput and backlog), with an optional Grafana stack
- Structured JSON logs (pino) with request ids, trace ids and secret redaction
- Liveness and readiness probes, graceful shutdown
- OpenAPI 3.1 document and interactive API reference at `/docs`
- Docker image and a Compose stack (PostgreSQL, Redis, Mailpit)
- Data retention job for expired sessions, codes and old login history
- Integration tests against a real database, CI on GitHub Actions
- Security automation: CodeQL, Trivy image scanning with an SBOM, dependency review, Dependabot, secret scanning with push protection

## Tech Stack

| Area | Tools |
| --- | --- |
| Runtime | Node.js 24 (native ES modules), TypeScript 6 |
| HTTP | Express 5, helmet, cors, express-rate-limit (+ Redis store) |
| Database | PostgreSQL, Prisma 7 with the `pg` driver adapter |
| Validation | Zod 4 (also used to generate the OpenAPI document) |
| Auth | @simplewebauthn/server, jsonwebtoken, @node-rs/argon2, otplib, qrcode |
| Email | Nodemailer (SMTP, Gmail OAuth2 or console) |
| Logging | pino, pino-http |
| Tooling | tsx, ESLint 10, Vitest, Supertest, Docker |

## Quick Start

### With Docker

```bash
export ENCRYPTION_KEY=$(openssl rand -base64 32)
docker compose up --build
```

This starts PostgreSQL, Redis, [Mailpit](https://mailpit.axllent.org/) and the API, after applying the migrations.

- API: <http://localhost:4000/api/v1>
- Emails sent by the API: <http://localhost:8025>

The container runs with `NODE_ENV=production`, so the API reference is off unless you set `API_DOCS_ENABLED=true`. Host ports can be changed with `API_PORT`, `DB_PORT`, `REDIS_PORT`, `MAILPIT_UI_PORT` and `MAILPIT_SMTP_PORT`.

### Locally

Requirements: Node.js 24+ (see `.nvmrc`), Yarn 1.x and PostgreSQL (`docker compose up -d db mailpit` works).

```bash
git clone https://github.com/KhaledSaeed18/node-authentication-template.git
cd node-authentication-template
yarn install            # also generates the Prisma client
cp .env.example .env    # then fill in DATABASE_URL and ENCRYPTION_KEY
yarn db:migrate
yarn dev
```

The API reference is then at <http://localhost:4000/docs>. With the default `MAIL_TRANSPORT=console`, emails (and their codes) are printed in the server log.

## Configuration

All settings are environment variables, validated at startup: the server refuses to start with a clear message if something is missing or invalid. See [`.env.example`](.env.example).

| Variable | Default | Description |
| --- | --- | --- |
| `NODE_ENV` | `development` | `development`, `test` or `production` |
| `PORT` | `4000` | HTTP port |
| `BASE_URL` / `API_VERSION` | `/api` / `v1` | Routes are served under `/api/v1` |
| `DATABASE_URL` | required | PostgreSQL connection string |
| `ENCRYPTION_KEY` | required | 32 random bytes, base64. Keys for code hashing and for encrypting 2FA secrets and signing keys |
| `JWT_ISSUER` / `JWT_AUDIENCE` | `node-auth` / `node-auth-api` | Checked on every access token |
| `ACCESS_TOKEN_TTL` / `REFRESH_TOKEN_TTL` | `15m` / `7d` | Token lifetimes (`s`, `m`, `h`, `d`) |
| `SIGNING_KEY_ROTATION_DAYS` | `30` | Age at which a new access token signing key is created |
| `CORS_ORIGINS` | `http://localhost:3000` | Comma separated list of allowed origins |
| `OIDC_ISSUER` | `http://localhost:4000` | Public URL of this service, the `iss` of ID tokens |
| `OIDC_LOGIN_URL` | `http://localhost:3000/login` | Front-end page that signs users in during an authorization request |
| `WEBAUTHN_RP_ID` | `localhost` | Domain passkeys are bound to (e.g. `example.com`) |
| `WEBAUTHN_ORIGINS` | `http://localhost:3000` | Comma separated front-end origins allowed to use passkeys |
| `TRUST_PROXY` | `false` | Express trust proxy setting, needed behind a load balancer for correct client IPs |
| `REDIS_URL` | unset | Share rate limit counters between instances |
| `RATE_LIMIT_ENABLED` | `true` | Turn rate limiting off (used by the tests) |
| `LOG_LEVEL` | `info` | pino log level |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Turns on OpenTelemetry export (e.g. `http://localhost:4318`); the standard `OTEL_*` variables apply |
| `OTEL_SERVICE_NAME` | `node-auth` | Service name in traces and metrics |
| `APP_NAME` | `Node Auth` | Shown in emails and authenticator apps |
| `API_DOCS_ENABLED` | on outside production | Serve `/docs` |
| `LOGIN_HISTORY_RETENTION_DAYS` | `90` | Used by the cleanup job |
| `SECURITY_EVENT_RETENTION_DAYS` | `365` | How long account activity is kept |
| `OUTBOX_WORKER_ENABLED` | `true` | Run the outbox worker inside the API process |
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | How often the worker looks for due jobs |
| `MAIL_TRANSPORT` | `console` | `console`, `smtp` or `gmail` |
| `MAIL_FROM` | `Node Auth <no-reply@example.com>` | Sender address |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS` | | For `MAIL_TRANSPORT=smtp` (SES, Postmark, Mailgun, ...) |
| `GMAIL_USER`, `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN` | | For `MAIL_TRANSPORT=gmail` |

## Scripts

| Script | Description |
| --- | --- |
| `yarn dev` | Start the dev server with `tsx watch` |
| `yarn build` | Compile to `dist/` |
| `yarn start` | Run the compiled server |
| `yarn test` | Run the test suite (needs `TEST_DATABASE_URL`) |
| `yarn test:watch` | Tests in watch mode |
| `yarn typecheck` | Type-check source, tests and config |
| `yarn lint` | ESLint |
| `yarn db:generate` | Regenerate the Prisma client (runs on install) |
| `yarn db:migrate` | Create and apply migrations in development |
| `yarn db:deploy` | Apply pending migrations in production |
| `yarn db:studio` | Open Prisma Studio |
| `yarn db:cleanup` | Delete expired sessions, codes and old login history |

## API

The full reference is served at `/docs` (OpenAPI document at `/docs/openapi.json`). All routes below are under `/api/v1` except the probes. Protected routes expect `Authorization: Bearer <accessToken>`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/auth/signup` | | Create an account, emails a verification code |
| POST | `/auth/verify-email` | | Verify the email with the code |
| POST | `/auth/resend-verification` | | Send a new verification code |
| POST | `/auth/signin` | | Sign in; returns tokens or a 2FA challenge |
| POST | `/auth/2fa/signin` | | Finish a 2FA sign in with `{ mfaToken, code }` |
| POST | `/auth/refresh-token` | | Rotate the refresh token, get a new token pair |
| POST | `/auth/forgot-password` | | Email a password reset code |
| POST | `/auth/reset-password` | | Set a new password with the code |
| POST | `/auth/change-password` | yes | Change the password, signs out other sessions |
| POST | `/auth/logout` | yes | End the current session |
| POST | `/auth/logout-all` | yes | End every session |
| GET | `/auth/sessions` | yes | List active sessions |
| DELETE | `/auth/sessions/:sessionId` | yes | End one session |
| GET | `/auth/login-history` | yes | Sign-in attempts (`?limit=&cursor=`) |
| POST | `/auth/2fa/setup` | yes | Start 2FA setup, returns secret and QR code |
| POST | `/auth/2fa/verify` | yes | Turn 2FA on, returns recovery codes |
| POST | `/auth/2fa/recovery-codes` | yes | Replace the recovery codes |
| POST | `/auth/2fa/disable` | yes | Turn 2FA off |
| POST | `/auth/passkeys/signin/options` | | Start a passwordless sign-in |
| POST | `/auth/passkeys/signin` | | Finish it with the authenticator response |
| POST | `/auth/passkeys/register/options` | yes | Start registering a passkey |
| POST | `/auth/passkeys/register` | yes | Finish registering it |
| GET | `/auth/passkeys` | yes | List passkeys |
| PATCH | `/auth/passkeys/:passkeyId` | yes | Rename a passkey |
| DELETE | `/auth/passkeys/:passkeyId` | yes | Remove a passkey |
| GET | `/users/me` | yes | Current user |
| PATCH | `/users/me` | yes | Update first/last name |
| GET | `/users/me/activity` | yes | Account activity (`?limit=&cursor=`) |
| GET | `/users/:userId/activity` | admin | A user's account activity |
| GET, POST | `/oauth-clients` | admin | List and register OpenID Connect clients |
| DELETE | `/oauth-clients/:clientId` | admin | Remove a client |
| GET | `/users` | admin | List users (`?limit=&cursor=`) |
| GET | `/.well-known/jwks.json` | | Public keys for verifying access tokens |
| GET | `/health` | | Liveness probe |
| GET | `/ready` | | Readiness probe (database, Redis, signing keys) |

### OpenID Connect provider

The service is also an OpenID Connect provider (authorization code flow with PKCE), so other applications can sign their users in with it. Protocol endpoints sit at the issuer root (`OIDC_ISSUER`):

| Endpoint | Purpose |
| --- | --- |
| `GET /.well-known/openid-configuration` | Discovery document |
| `GET /oauth/authorize` | Start an authorization request |
| `GET /oauth/interactions/:id` | What the login page shows (client name, scopes) |
| `POST /oauth/interactions/:id/complete` | Called by the login page once the user is signed in (`{ consent: true }` for third-party clients) |
| `POST /oauth/token` | `authorization_code` and `refresh_token` grants |
| `GET, POST /oauth/userinfo` | Claims for an access token issued to a client |

The provider is headless, so your front end owns the login page:

1. An admin registers the client: `POST /api/v1/oauth-clients` with `name`, `redirectUris`, `scopes`, `confidential` and `firstParty`. The secret is returned once.
2. The client sends the browser to `/oauth/authorize` with `response_type=code`, `scope=openid ...`, a PKCE `code_challenge` (S256), `state` and `nonce`.
3. The service redirects to `OIDC_LOGIN_URL?interaction=<id>`. The page signs the user in with the regular API (password, 2FA or passkey), optionally shows `GET /oauth/interactions/<id>` for consent, then calls `POST /oauth/interactions/<id>/complete` with the user's access token and sends the browser to the returned `redirectTo`.
4. The client exchanges the code at `/oauth/token` and gets an `access_token`, an `id_token` and, with the `offline_access` scope, a `refresh_token`.

Any standard OpenID Connect library works on the client side. Access tokens issued to a client are addressed to that client (`aud` = client id), so they are accepted by `/oauth/userinfo` and the client's own APIs, but not by this service's account API.

### Verifying tokens in other services

Access tokens are ES256 JWTs with a `kid` header. Any service can verify them with the public keys, without sharing a secret. For example with [jose](https://github.com/panva/jose):

```ts
import { createRemoteJWKSet, jwtVerify } from 'jose';

const jwks = createRemoteJWKSet(new URL('https://auth.example.com/.well-known/jwks.json'));

const { payload } = await jwtVerify(accessToken, jwks, {
    issuer: 'node-auth',        // JWT_ISSUER
    audience: 'node-auth-api',  // JWT_AUDIENCE
    algorithms: ['ES256'],
});
// payload.sub = user id, payload.role, payload.sid = session id
```

Note that only this service checks whether the session was revoked; other services see a revoked session's token as valid until it expires (15 minutes by default).

### Responses

Successful responses:

```json
{ "status": "success", "statusCode": 200, "message": "User signed in successfully", "data": {} }
```

Errors carry a stable, machine-readable `code`:

```json
{
  "status": "fail",
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Validation failed. Please check your input.",
  "validationErrors": [{ "field": "email", "message": "Invalid email format" }]
}
```

### Sign in flow

1. `POST /auth/signin` with email and password.
2. Without 2FA, the response contains `accessToken` and `refreshToken`.
3. With 2FA, it contains `{ requiresTwoFactor: true, mfaToken }`. Send `POST /auth/2fa/signin` with the `mfaToken` and a 6 digit code (or a recovery code) within 5 minutes.
4. Or, without a password: `POST /auth/passkeys/signin/options`, pass the `options` to the browser (for example `startAuthentication({ optionsJSON: options })` from `@simplewebauthn/browser`) and send the result to `POST /auth/passkeys/signin`.
5. When the access token expires, call `POST /auth/refresh-token`. Always keep the new refresh token from the response: the old one stops working, and presenting it again later revokes the session.

## Security Notes

- **Passwords** are hashed with Argon2id (19 MiB, t=2, p=1). Hashes from older versions (bcrypt) keep working and are upgraded on the next sign in.
- **Lockout**: 5 failed sign-ins (password or 2FA code) within 15 minutes lock the account until the failures age out. Unknown emails are checked against a dummy hash so they take as long to reject as a wrong password.
- **Codes** for email verification and password reset are stored as HMACs keyed from `ENCRYPTION_KEY`, are single use, expire after 15 minutes and are discarded after 5 wrong attempts.
- **Enumeration**: endpoints that take an email answer the same way whether or not the account exists. Signup still returns 409 for a taken email; that is a deliberate usability tradeoff and it is rate limited.
- **Refresh tokens** are random, stored as SHA-256 hashes and rotated on every use. A reused token revokes its session (with a 10 second grace window for concurrent refreshes).
- **Passkeys** require user verification and are tied to `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS`. Challenges are single use and expire after 5 minutes, which is what stops replays for synced passkeys (their signature counter is always 0); for other authenticators a counter that goes backwards is rejected as a likely clone.
- **OpenID Connect**: PKCE (S256) is required for every client, redirect URIs must match exactly and are never redirected to when unregistered, authorization responses carry `iss` (RFC 9207), codes are single use and a reused code revokes the session issued from it, and client tokens can't reach the account API.
- **Access tokens** are signed with ES256 keys that rotate automatically; verification pins the algorithm and resolves the key by `kid`, so unsigned or HS256-forged tokens are rejected. A signing key that can't be decrypted makes the instance fail closed and report not ready.
- **2FA secrets** are encrypted with AES-256-GCM. The last accepted time step is stored so a code can't be used twice.
- **Sessions** end on logout, password reset (all sessions) and password change (all other sessions).
- **Keep `ENCRYPTION_KEY` safe and stable**: changing it invalidates outstanding codes and makes stored 2FA secrets and signing keys unreadable.

## Project Structure

```bash
├── prisma
│   ├── migrations
│   └── schema.prisma
├── src
│   ├── app.ts                      # builds the Express app (dependency injection root)
│   ├── server.ts                   # starts the server, graceful shutdown
│   ├── config/env.ts               # validated environment variables
│   ├── docs                        # OpenAPI document and /docs
│   ├── lib                         # logger, Prisma client, Redis client
│   ├── mail                        # mailer transports and email templates
│   ├── modules
│   │   ├── audit                   # account activity (security events)
│   │   ├── auth                    # routes, controller, service, schemas, rate limits,
│   │   │                           # sessions, tokens, TOTP, verification and recovery codes
│   │   ├── users                   # profile and admin endpoints
│   │   ├── health                  # liveness and readiness probes
│   │   ├── maintenance             # data retention job
│   │   ├── oidc                    # OpenID Connect provider
│   │   └── outbox                  # transactional outbox and its worker
│   ├── scripts                     # entry points for the cleanup job and a standalone worker
│   ├── shared                      # errors, middlewares, crypto/password utils, validation
│   └── generated/prisma            # generated Prisma client (gitignored)
├── tests                           # integration and unit tests
├── compose.yaml
├── Dockerfile
└── prisma.config.ts
```

Each module follows the same layering: **routes** wire middlewares (rate limit, authentication, validation) to the **controller**, which only translates HTTP into calls on the **service**. Services hold the business logic, receive their dependencies (Prisma, mailer, other services) through the constructor and throw typed `AppError`s that the central error handler turns into responses.

## Testing

The tests run against a real PostgreSQL database:

```bash
docker compose up -d db                     # also creates the auth_test database
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_test
yarn test
```

Emails are captured by an in-memory mailer, so tests read the codes directly.

## Deployment

- Build the image with `docker build -t node-auth .`. It runs as a non-root user, has a health check on `/health`, ships without npm/yarn, and is built, smoke tested and scanned by CI on every push.
- Run `node_modules/.bin/prisma migrate deploy` from the same image as a release step before starting new instances.
- Set `NODE_ENV=production`, the required secrets, `TRUST_PROXY` when behind a load balancer and `REDIS_URL` when running more than one instance.
- Schedule `node dist/scripts/cleanup.js`, for example daily.
- Emails are delivered by the outbox worker, which runs inside each API instance by default. To scale it separately, set `OUTBOX_WORKER_ENABLED=false` on the API and run `node dist/scripts/worker.js` as its own deployment; any number of workers can run at once.
- Point the readiness probe at `/ready` and the liveness probe at `/health`. On `SIGTERM` the server reports not ready, finishes in-flight requests and closes its connections.

## Observability

Telemetry is off until `OTEL_EXPORTER_OTLP_ENDPOINT` points at an OpenTelemetry collector or any OTLP backend (Grafana, Honeycomb, Datadog, ...). The instrumentation is loaded with `node --import ./dist/instrumentation.js` (already done by `yarn start`, `yarn dev` and the Docker image).

To try it locally with Grafana, Tempo, Prometheus and Loki in one container:

```bash
docker compose -f compose.yaml -f compose.observability.yaml up --build
```

Then open Grafana at <http://localhost:3001>. Custom metrics:

| Metric | Attributes |
| --- | --- |
| `auth.signin.attempts` | `method` (password, two_factor, passkey), `result` (success, failure, locked, second_factor_required) |
| `auth.account.lockouts` | |
| `auth.refresh_token.reuse` | |
| `outbox.jobs.processed` | `type`, `outcome` (done, retry, failed) |
| `outbox.jobs.pending` | gauge |

## Design Documents

- [Architecture](docs/architecture.md): components, flows (sign in, refresh rotation, passkeys, outbox) and data model, with diagrams
- [Architecture decision records](docs/adr/README.md): why opaque rotating refresh tokens, Argon2id, an outbox in PostgreSQL, ES256 with JWKS, passkeys as a full factor, a headless OpenID Connect provider, and more
- [Threat model](docs/threat-model.md): STRIDE analysis with mitigations, the tests that cover them, and residual risks

## Upgrading from 1.x

See [CHANGELOG.md](CHANGELOG.md) for the breaking changes and new environment variables.

## Contributing

Contributions are welcome. Please read [CONTRIBUTING.md](CONTRIBUTING.md) before opening an issue or pull request.

## License

This project is licensed under the [MIT License](LICENSE).
