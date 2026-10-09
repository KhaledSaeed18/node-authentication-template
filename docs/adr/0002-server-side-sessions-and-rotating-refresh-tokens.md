# 0002. Server-side sessions and rotating opaque refresh tokens

**Status:** Accepted

## Context

Refresh tokens used to be 7-day JWTs signed with a shared secret. They could not be revoked: logout, a password reset or a stolen token had no effect until expiry.

## Decision

- Every sign-in creates a `Session` row. The refresh token is `<sessionId>.<secret>` with a 256-bit random secret; only its SHA-256 is stored.
- Every refresh rotates the secret. The previous hash is kept: presenting it again means the token leaked, so the session is revoked and the owner is alerted. Within 10 seconds of a rotation the old token is rejected without revoking, to tolerate two tabs refreshing at once.
- Access tokens stay short-lived (15 minutes) and carry the session id. The `authenticate` middleware checks that the session is still active on every request.
- Logout, logout everywhere, revoking a session, password reset (all sessions) and password change (other sessions) all end sessions immediately.

## Alternatives considered

- **Stateless refresh tokens with a denylist**: the denylist is the same lookup, plus the risk of forgetting to add to it.
- **Fully stateless access tokens** (no session lookup): saves one primary-key read per request, but revocation then waits up to the access token lifetime. For an auth service, immediate revocation is worth that read.
- **Refresh tokens in httpOnly cookies**: safer against XSS for browser clients, but ties the API to cookie handling and CSRF protection. The API stays client-agnostic; a browser front end can wrap it in a backend-for-frontend.

## Consequences

- One indexed lookup per authenticated request.
- Other services that verify access tokens themselves through the JWKS do not see revocations until the token expires (documented in the README).
- Clients must always store the refresh token returned by the last refresh.
