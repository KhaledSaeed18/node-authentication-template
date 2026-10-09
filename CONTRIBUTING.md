# Contributing to Node Authentication Template

Thanks for your interest in improving this project. This guide covers everything from setting up your machine to getting a pull request merged.

By participating you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md). Security problems are **not** reported through issues: see the [Security Policy](SECURITY.md).

## Table of Contents

- [Ways to Contribute](#ways-to-contribute)
- [Development Setup](#development-setup)
- [Architecture](#architecture)
- [Adding an Endpoint](#adding-an-endpoint)
- [Database Changes](#database-changes)
- [Testing](#testing)
- [Code Style](#code-style)
- [Security Guidelines](#security-guidelines)
- [Commit Messages](#commit-messages)
- [Pull Requests](#pull-requests)
- [Releases](#releases)

## Ways to Contribute

- **Report a bug** with the [bug report form](https://github.com/KhaledSaeed18/node-authentication-template/issues/new?template=bug_report.yml).
- **Suggest a feature** with the [feature request form](https://github.com/KhaledSaeed18/node-authentication-template/issues/new?template=feature_request.yml). For anything bigger than a small fix, please open an issue first so we can agree on the approach before you write code.
- **Improve the docs**: README, this guide, code comments or the OpenAPI document.
- **Pick an issue** labeled [`good first issue`](https://github.com/KhaledSaeed18/node-authentication-template/labels/good%20first%20issue) or [`help wanted`](https://github.com/KhaledSaeed18/node-authentication-template/labels/help%20wanted). Comment on it so others know you're working on it.

## Development Setup

### Prerequisites

- **Node.js 24+**. The repository has an `.nvmrc`, so `nvm use` (or `fnm use`) picks the right version.
- **Yarn 1.x** (`corepack enable` or `npm i -g yarn`).
- **Docker** for PostgreSQL, Redis and Mailpit. A local PostgreSQL works too.

### First run

```bash
# 1. Fork the repository on GitHub, then clone your fork
git clone https://github.com/<your-username>/node-authentication-template.git
cd node-authentication-template
git remote add upstream https://github.com/KhaledSaeed18/node-authentication-template.git

# 2. Install dependencies (also generates the Prisma client into src/generated/prisma)
yarn install

# 3. Configure the environment
cp .env.example .env
#    then set at least:
#    DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth
#    ENCRYPTION_KEY=<output of: openssl rand -base64 32>

# 4. Start PostgreSQL (it also creates the auth_test database) and Mailpit
docker compose up -d db mailpit

# 5. Apply the migrations and start the dev server
yarn db:migrate
yarn dev
```

Then:

- the API is at <http://localhost:4000/api/v1>
- the interactive API reference is at <http://localhost:4000/docs>
- with `MAIL_TRANSPORT=console` (the default) emails, including their codes, are printed in the server log. To see them rendered, set `MAIL_TRANSPORT=smtp`, `SMTP_HOST=localhost`, `SMTP_PORT=1025` and open Mailpit at <http://localhost:8025>.

If a port is already taken, change it in `.env` (`PORT`) or for Compose with `DB_PORT`, `REDIS_PORT`, `MAILPIT_UI_PORT`, `MAILPIT_SMTP_PORT`.

### Useful scripts

| Script | What it does |
| --- | --- |
| `yarn dev` | Dev server with reload (`tsx watch`) |
| `yarn lint` | ESLint |
| `yarn typecheck` | Type-check `src`, `tests` and config files |
| `yarn test` / `yarn test:watch` | Test suite (needs `TEST_DATABASE_URL`) |
| `yarn build` | Compile to `dist/` |
| `yarn db:migrate` | Create/apply migrations in development |
| `yarn db:generate` | Regenerate the Prisma client |
| `yarn db:studio` | Browse the database |
| `yarn db:cleanup` | Run the data retention job |

## Architecture

```text
src/
├── app.ts            builds the Express app and wires the modules (composition root)
├── server.ts         starts the HTTP server, graceful shutdown
├── config/env.ts     every environment variable, validated with Zod
├── docs/             OpenAPI document and the /docs route
├── lib/              logger, Prisma client, Redis client
├── mail/             Mailer interface, transports and templates
├── modules/
│   ├── auth/         routes, controller, service, schemas, rate limits, and the
│   │                 session, token, TOTP, verification and recovery code services
│   ├── users/        profile and admin endpoints
│   ├── health/       /health and /ready
│   ├── maintenance/  data retention job
│   └── outbox/       transactional outbox: enqueue() and the worker
├── scripts/          standalone entry points (cleanup, worker)
└── shared/           errors, middlewares, utils and reusable validation
```

### Request lifecycle

```text
request
  → CORS → (/health, /ready, /docs answer here) → request logger → helmet → JSON body (10kb max)
  → route: rate limiter → authenticate (if protected) → validate(schema)
  → controller: reads the validated request, calls the service, sends the response
  → service: business logic, database access, throws AppError on failure
  → error handler: turns any error into a JSON response with a stable code
```

### Conventions that hold the structure together

- **Controllers are thin.** They read `req.body` / `req.query` (already validated and parsed), call one service method and respond with `sendSuccess()`. No business logic and no try/catch: Express 5 forwards rejected promises to the error handler.
- **Services don't know about Express.** They take typed inputs (inferred from the Zod schemas), get their dependencies through the constructor, return plain data and throw `AppError` subclasses (`BadRequestError`, `UnauthorizedError`, `ConflictError`, ...) with a stable error `code`.
- **Dependencies are injected.** `createApp(overrides)` builds everything; tests pass an in-memory mailer, and could pass any other replacement the same way. Each module has an `index.ts` that wires its own pieces.
- **Configuration only comes from `env`** (`src/config/env.ts`), never from `process.env` directly. To add a variable: add it to the schema, to `.env.example` and to the configuration table in the README.
- **Logging goes through pino.** Inside a request use `req.log`; elsewhere import `logger`. Never use `console`.
- **Side effects go through the outbox.** Don't send emails (or call other services) from a request. Declare a job type in the module's `*.jobs.ts`, write it with `enqueue(tx, type, payload)` inside the same `$transaction` as the change, and handle it in the module's job handlers. Payloads must not contain secrets.

### Background jobs

```ts
// src/modules/<module>/<module>.jobs.ts
declare module '../outbox/outbox.js' {
    interface OutboxJobs {
        'email.welcome': { userId: string };
    }
}

// in a service, together with the change
await this.db.$transaction(async (tx) => {
    const user = await tx.user.create({ data });
    await enqueue(tx, 'email.welcome', { userId: user.id });
});
```

Handlers receive the payload and `{ attempt }`. They should be idempotent where possible: a job is retried if the handler throws, so it may run more than once.

## Adding an Endpoint

Use an existing endpoint (for example `change-password`) as a reference. A new endpoint usually touches:

1. **Schema**: add a Zod schema to the module's `*.schemas.ts` and export its inferred type. Reuse `personName`, `paginationQuerySchema` and the password/email fields where they fit.
2. **Service**: add a method that takes the typed input, does the work and throws `AppError`s.
3. **Controller**: add a handler that calls the service and responds with `sendSuccess(res, status, message, data)`.
4. **Route**: register it with a rate limiter (`createLimiter('name', limit)`), `authenticate` if it's protected, and `validate(schema)` / `validate(schema, 'query' | 'params')`.
5. **OpenAPI**: add the path to `src/docs/openapi.ts`, reusing the same Zod schema for the request.
6. **Tests**: cover the success path and the failure modes (validation, authentication, authorization, and abuse cases for anything security related).
7. **Docs**: update the endpoint table in the README, and the CHANGELOG if it's a breaking change.

## Database Changes

1. Edit `prisma/schema.prisma`.
2. Create the migration with a descriptive name:

   ```bash
   yarn db:migrate --name add_user_avatar
   ```

3. Review the generated SQL in `prisma/migrations/`. For data changes (backfills, normalization), add the SQL to the migration by hand, as done in `lowercase_emails`.
4. Commit the schema and the migration together.

Rules:

- **Never edit a migration that is already on `main`**; add a new one.
- Keep migrations backwards compatible when possible (add a column, deploy, then remove the old one in a later release).
- Since Prisma 7, `migrate dev` doesn't regenerate the client. Run `yarn db:generate` if your editor doesn't pick up the new types.

## Testing

Tests use [Vitest](https://vitest.dev/) and [Supertest](https://github.com/ladjs/supertest), and run against a real PostgreSQL database rather than mocks:

```bash
docker compose up -d db
export TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5432/auth_test
yarn test
```

Migrations are applied automatically before the run. Test files run one after another because they share the database.

Helpers in `tests/helpers.ts`:

| Helper | Use |
| --- | --- |
| `resetDatabase()` | Truncates every table, call it in `beforeEach` |
| `InMemoryMailer` | Pass to `createApp({ mailer })`; `mailer.lastCode(email)` returns the last emailed code |
| `createTestApp()` | App, in-memory mailer and outbox worker wired together; `await mailer.lastCode(email)` delivers pending jobs first |
| `eventually(fn)` | Retries an assertion until it passes, for timing-based checks |
| `VirtualAuthenticator` | Software WebAuthn authenticator (`tests/support`): `createCredential(options)` and `getAssertion(options)` produce real, signed responses |
| `strongPassword`, `API` | A password that passes validation, and the `/api/v1` prefix |

What good tests look like here:

- Test through HTTP (`request(app)`) whenever possible, so routing, validation and error handling are covered too.
- Assert the error `code`, not only the status.
- For security features, test the attack, not just the happy path: replayed codes, reused tokens, parallel guesses, other users' resources.
- Keep tests independent: create the data each test needs.

## Code Style

- **TypeScript in strict mode**, no `any` unless there's no reasonable alternative.
- **Native ES modules**: relative imports end in `.js` (`import { x } from './x.js'`), type-only imports use `import type`.
- **File names** are kebab-case and suffixed by role: `auth.service.ts`, `auth.routes.ts`, `session.service.ts`, `rate-limit.ts`.
- **Comments explain why**, not what. A short comment on a non-obvious decision is worth more than a paragraph on obvious code.
- **Prefer small, focused functions** and early returns over nested conditions.
- Run `yarn lint` and `yarn typecheck` before pushing; CI runs them too. Unused parameters are prefixed with `_`.

## Security Guidelines

This is authentication code, so a few rules are non-negotiable:

- **Never log or return secrets**: passwords, tokens, codes, TOTP secrets or hashes. The logger redacts common fields, but don't rely on it.
- **Compare secrets in constant time** with `safeEqual`, never with `===`.
- **Store secrets hashed or encrypted**: random tokens with `sha256`, short codes with `hmacSha256` and a key from `deriveKey()`, reversible secrets with `encrypt()`.
- **Don't reveal whether an account exists** on endpoints that take an email, through either the response or the timing.
- **Rate limit and validate every new endpoint**, and enforce ownership (`userId` filters) on every query for user data.
- **Think about concurrency** for anything single-use: use conditional updates (`updateMany` with a `where` that includes the expected state) so two parallel requests can't both succeed.

If you're unsure about the security impact of a change, say so in the pull request.

## Commit Messages

Commits follow [Conventional Commits](https://www.conventionalcommits.org/):

```text
<type>(<optional scope>): <short summary in the imperative>

<optional body: what changed and why>
```

**Types**: `feat`, `fix`, `refactor`, `perf`, `test`, `docs`, `build`, `ci`, `chore`

**Common scopes**: `auth`, `2fa`, `users`, `mail`, `db`, `security`, `config`, `docs`, `docker`, `ci`, `deps`

Examples:

```text
feat(auth): logout, logout everywhere and session management
fix(security): stop revealing which emails have an account
refactor(auth): thin controllers, framework-free service, typed errors
```

Guidelines:

- Keep each commit focused on one change, and keep the summary under ~72 characters.
- Use the body to explain the reason, especially for fixes and security changes.
- Mark breaking changes with `!` (`feat(auth)!: ...`) and describe the migration path in the body.

## Pull Requests

1. Sync with upstream and create a branch:

   ```bash
   git fetch upstream
   git checkout -b feat/short-description upstream/main
   ```

   Branch prefixes: `feat/`, `fix/`, `docs/`, `refactor/`, `chore/`.

2. Make your change with tests, keeping the pull request focused. Several small PRs are easier to review than one large one.
3. Make sure `yarn lint`, `yarn typecheck`, `yarn build` and `yarn test` pass.
4. Open the pull request and fill in the template. Link the issue (`Closes #123`).
5. CI must be green. Address review comments with new commits; they can be squashed when merging.

Open a draft pull request early if you'd like feedback on the approach.

## Releases

For maintainers:

1. Update `CHANGELOG.md` with the changes since the last release, including upgrade notes for breaking changes.
2. Bump `version` in `package.json` following [Semantic Versioning](https://semver.org/).
3. Commit (`chore: release x.y.z`), tag (`git tag vx.y.z`) and push the tag.
4. Create a GitHub release from the tag with the changelog section as notes.

Thanks again for contributing!
