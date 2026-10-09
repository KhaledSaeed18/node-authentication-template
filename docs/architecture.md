# Architecture

This document describes how the service is put together and how its main flows work. The reasoning behind the bigger choices is recorded in the [architecture decision records](adr/README.md), and the security analysis is in the [threat model](threat-model.md).

## System context

```mermaid
flowchart LR
    user([User]) -->|HTTPS| client[Web or mobile client]
    client -->|REST, JSON| api[Auth API]
    other[Other services] -->|fetch public keys| jwks[/.well-known/jwks.json/]
    jwks --- api
    other -->|verify access tokens locally| other
    api --> pg[(PostgreSQL)]
    api -.->|optional, shared rate limits| redis[(Redis)]
    worker[Outbox worker] --> pg
    worker -->|SMTP / Gmail| mail[Mail provider]
    mail --> user
```

- **Auth API**: Express 5 application. Stateless apart from its database: any number of instances can run behind a load balancer.
- **Outbox worker**: delivers background jobs (emails). Runs inside each API process by default, or as separate processes.
- **PostgreSQL**: the only required infrastructure. Holds users, sessions, codes, keys, the outbox and the activity log.
- **Redis**: optional, only to share rate limit counters between instances.
- **Other services** verify access tokens with the public keys from the JWKS endpoint, without sharing any secret.
- **Client applications** can sign their users in through the OpenID Connect endpoints.

## Code layout

```mermaid
flowchart TB
    subgraph http[HTTP layer]
        routes[routes: rate limit, authenticate, validate] --> controllers[controllers]
    end
    subgraph domain[Services]
        auth[AuthService]
        sessions[SessionService]
        passkeys[PasskeyService]
        codes[VerificationCodeService]
        recovery[RecoveryCodeService]
        users[UsersService]
        events[SecurityEventsService]
    end
    subgraph infra[Infrastructure]
        prisma[(Prisma / PostgreSQL)]
        keys[SigningKeyStore]
        outbox[Outbox + worker]
        mailer[Mailer]
    end
    controllers --> auth & users & events
    auth --> sessions & passkeys & codes & recovery & keys & outbox
    sessions & passkeys & codes & recovery & users & events --> prisma
    outbox --> prisma
    outbox --> mailer
```

Rules that hold the structure together:

- **Controllers only translate HTTP.** They read the validated request, call one service method and shape the response. Express 5 forwards rejected promises, so there is no try/catch.
- **Services don't know about Express.** They take typed inputs (inferred from the Zod schemas), get dependencies through their constructor and throw `AppError`s with stable codes.
- **Composition happens in one place.** `buildApplication()` in `src/app.ts` wires every module; tests call it with an in-memory mailer.
- **Side effects go through the outbox**, written in the same transaction as the change that causes them.

## Main flows

### Sign in with a password and 2FA

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as API
    participant DB as PostgreSQL
    C->>A: POST /auth/signin {email, password}
    A->>DB: find user, count recent failures (lockout)
    A->>A: Argon2id verify (dummy hash if the email is unknown)
    alt 2FA enabled
        A-->>C: {requiresTwoFactor: true, mfaToken} (5 min, own key)
        C->>A: POST /auth/2fa/signin {mfaToken, code}
        A->>A: verify TOTP (replay-safe) or recovery code
    end
    A->>DB: new-device check, login history, create session
    A->>A: sign ES256 access token (kid = current key)
    A-->>C: {accessToken, refreshToken = sessionId.secret}
```

### Refresh token rotation

```mermaid
sequenceDiagram
    autonumber
    participant C as Client
    participant A as API
    participant DB as PostgreSQL
    C->>A: POST /auth/refresh-token {sessionId.secret}
    A->>DB: load session, compare sha256(secret)
    alt matches the current token
        A->>DB: conditional update: new hash, previous = old hash
        A-->>C: new access + refresh token
    else matches the previous token (reuse)
        alt rotated less than 10s ago
            A-->>C: 401 TOKEN_ROTATED (concurrent refresh, session kept)
        else
            A->>DB: revoke session, record event, enqueue alert email
            A-->>C: 401 TOKEN_REUSED
        end
    end
```

### Passkey sign-in

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant A as API
    participant DB as PostgreSQL
    B->>A: POST /auth/passkeys/signin/options
    A->>DB: store challenge (single use, 5 min)
    A-->>B: request options (no allowCredentials: usernameless)
    B->>B: navigator.credentials.get(), biometrics or PIN
    B->>A: POST /auth/passkeys/signin {response}
    A->>DB: delete the challenge read from clientDataJSON (atomic, once)
    A->>A: verify signature, origin, RP id, user verification, counter
    A->>DB: update counter, start session
    A-->>B: tokens
```

### OpenID Connect sign-in for another application

```mermaid
sequenceDiagram
    autonumber
    participant B as Browser
    participant RP as Client app
    participant A as API (provider)
    participant L as Login page (front end)
    RP->>B: redirect to /oauth/authorize (PKCE S256, state, nonce)
    B->>A: GET /oauth/authorize
    A->>A: check client, exact redirect_uri, scopes, PKCE
    A-->>B: 302 to OIDC_LOGIN_URL?interaction=id
    B->>L: login page
    L->>A: sign in (password, 2FA or passkey)
    L->>A: POST /oauth/interactions/id/complete (consent if third party)
    A-->>L: redirectTo = redirect_uri?code&state&iss
    L->>B: navigate to redirectTo
    B->>RP: callback with code
    RP->>A: POST /oauth/token (code, code_verifier, client auth)
    A->>A: verify PKCE, single-use code, create client session
    A-->>RP: access_token (aud = client), id_token (ES256), refresh_token
    RP->>A: GET /.well-known/jwks.json, verify id_token
```

### Outbox delivery

```mermaid
sequenceDiagram
    autonumber
    participant S as Service
    participant DB as PostgreSQL
    participant W as Worker
    participant M as Mail provider
    S->>DB: BEGIN, change + INSERT OutboxMessage, COMMIT
    loop every second (or right away after a full batch)
        W->>DB: UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING
        W->>M: send (code generated now, never stored in the job)
        alt success
            W->>DB: status = DONE
        else failure
            W->>DB: PENDING with exponential backoff, FAILED after 5 attempts
        end
    end
```

## Data model

```mermaid
erDiagram
    User ||--o{ Session : has
    User ||--o{ LoginHistory : has
    User ||--o{ VerificationCode : has
    User ||--o{ RecoveryCode : has
    User ||--o{ Passkey : has
    User ||--o{ WebAuthnChallenge : has
    User ||--o{ SecurityEvent : has
    User {
        string id
        string email
        string password "Argon2id"
        string totpSecret "AES-256-GCM"
        int totpLastUsedStep
    }
    Session {
        string tokenHash "sha256"
        string previousTokenHash
        datetime expiresAt
        datetime revokedAt
    }
    VerificationCode {
        string codeHash "HMAC-SHA256"
        int attempts
    }
    Passkey {
        string id "credential id"
        bytes publicKey
        bigint counter
    }
    SigningKey {
        string id "kid"
        json publicJwk
        string privateKey "AES-256-GCM"
        datetime retiredAt
    }
    OutboxMessage {
        string type
        json payload
        string status
        datetime availableAt
    }
```

`SigningKey` and `OutboxMessage` are not tied to a user.

## Keys and secrets

One secret, `ENCRYPTION_KEY`, protects everything stored at rest. Purpose-specific keys are derived from it with HKDF, so they are independent of each other:

| Derived key | Used for |
| --- | --- |
| `verification-code` | HMAC of email codes |
| `recovery-code` | HMAC of 2FA recovery codes |
| `totp-secret` | AES-256-GCM encryption of TOTP secrets |
| `signing-key` | AES-256-GCM encryption of the ES256 private keys |
| `mfa-token` | HS256 signature of the short-lived 2FA challenge token |

Refresh tokens are 256-bit random values, so a plain SHA-256 is enough to store them. Access tokens are signed with the ES256 key pairs in `SigningKey`, rotated automatically.

## Scaling

- API instances share nothing but PostgreSQL (and Redis for rate limits if configured).
- Signing keys: each instance caches the key set and reloads when it sees an unknown key id; rotation is serialized with a Postgres advisory lock.
- Outbox workers claim jobs with `FOR UPDATE SKIP LOCKED`, so they can be scaled out independently (`OUTBOX_WORKER_ENABLED=false` on the API plus `node dist/scripts/worker.js`).
- Every authenticated request does one primary-key lookup to check the session is still active. That is what makes revocation immediate; see [ADR 0002](adr/0002-server-side-sessions-and-rotating-refresh-tokens.md).
