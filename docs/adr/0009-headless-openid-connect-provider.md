# 0009. Headless OpenID Connect provider

**Status:** Accepted

## Context

With ES256 tokens and a public JWKS ([0006](0006-es256-access-tokens-with-jwks-and-rotation.md)), other services can already verify tokens. The next step is letting other applications sign their users in through this service, with a standard protocol their libraries already speak. An OpenID Connect provider usually renders its own login and consent pages, but this service is an API without a UI, and its sign-in already supports passwords, 2FA and passkeys.

## Decision

- Implement the authorization code flow with PKCE, plus refresh tokens, ID tokens, userinfo and discovery. No implicit or hybrid flows: they are discouraged by OAuth 2.1 and the security best current practice.
- Keep it headless: `/oauth/authorize` validates the request and redirects to the front end's login page (`OIDC_LOGIN_URL`) with an interaction id. The page signs the user in through the regular API, shows consent when needed, and completes the interaction, which returns where to send the browser.
- Require PKCE with S256 for every client, confidential ones included. Match redirect URIs exactly; an unknown client or unregistered redirect URI gets an error response, never a redirect. Include `iss` in authorization responses (RFC 9207).
- Codes are single use, live 60 seconds and are stored hashed; presenting a used code revokes the session it produced.
- ID tokens and access tokens are signed with the same rotating ES256 keys. Access tokens issued to a client have `aud` set to the client id, so the account API rejects them.
- OAuth endpoints answer errors in the RFC 6749 format, not the API's usual envelope, because client libraries expect it.

## Alternatives considered

- **node-oidc-provider**: complete and certified, but brings its own interaction model, storage adapter and UI assumptions; integrating it with the existing sessions, passkeys and lockout would have taken as much code as the subset implemented here, and hidden the mechanics.
- **Hosting login pages in this service**: simpler for clients, but duplicates the front end's sign-in UI and couples the API to HTML rendering.

## Consequences

- Any standard client library works; the test suite proves it with `openid-client`, which validates discovery, PKCE, state, nonce, `iss` and the ID token signature.
- The front end must implement the login handoff (a page that reads `interaction`, signs in, and completes it).
- Token introspection (RFC 7662) and revocation (RFC 7009) were added afterwards. Not implemented yet: dynamic client registration, `prompt=login` / `max_age`, front- or back-channel logout.
