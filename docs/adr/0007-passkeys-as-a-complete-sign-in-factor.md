# 0007. Passkeys as a complete sign-in factor

**Status:** Accepted

## Context

Passwords are phished and reused. Passkeys (WebAuthn) are phishing-resistant because they are bound to the site's origin, and they are now supported by every major platform.

## Decision

- Users register passkeys while signed in and can then sign in without a password.
- Sign-in is usernameless: options carry no credential list, the browser offers the passkeys it has for the site.
- User verification (biometrics or PIN) is required. A passkey sign-in therefore already combines possession and inherence, so no TOTP code is asked for, and the password lockout does not apply (it protects guessable secrets, and would let an attacker lock a user out of their passkey too).
- Challenges are stored server-side, expire after 5 minutes and are consumed atomically. For synced passkeys, whose signature counter is always 0, this is the only replay protection; for other authenticators, a counter that goes backwards is rejected as a likely clone.
- Clients send the standard WebAuthn response; the server finds the challenge from the signed `clientDataJSON`.

## Alternatives considered

- **Passkeys only as a second factor**: wastes their main benefit.
- **Stateless signed challenges**: would need a separate replay store anyway.

## Consequences

- `WEBAUTHN_RP_ID` and `WEBAUTHN_ORIGINS` must match the front end's domain exactly; passkeys created for one RP id don't work on another.
- The test suite includes a software authenticator that produces real attestation and assertion structures, so the verification code is tested end to end.
