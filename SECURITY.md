# Security Policy

This project handles passwords, tokens and second factors, so security reports are taken seriously and handled before anything else.

## Supported Versions

| Version | Supported |
| --- | --- |
| 2.x | Yes |
| 1.x | No, please upgrade (see [CHANGELOG.md](CHANGELOG.md)) |

Fixes are released on the latest 2.x version.

## Reporting a Vulnerability

**Please do not open a public issue, discussion or pull request for security problems.**

Report it privately through GitHub instead:

1. Go to the [Security tab](https://github.com/KhaledSaeed18/node-authentication-template/security) of the repository.
2. Click **Report a vulnerability** ([direct link](https://github.com/KhaledSaeed18/node-authentication-template/security/advisories/new)).
3. Fill in the form. Only the maintainers can see it.

Please include as much as you can of:

- the affected endpoint, module or file
- the impact (what an attacker can do) and the conditions needed
- steps or a small script to reproduce it
- the version or commit you tested
- a suggested fix, if you have one

## What to Expect

- An acknowledgement within a few days.
- An assessment of the report and its severity, and a plan for the fix.
- Updates as the fix progresses, and credit in the advisory if you want it.
- A coordinated disclosure: the advisory is published once a fixed version is available. Please keep the details private until then.

## Scope

In scope: the code in this repository, its default configuration, the Dockerfile and the Compose stack.

Examples of what we especially want to hear about:

- authentication or session bypass, privilege escalation (e.g. reaching admin routes)
- ways around the account lockout, rate limits, code attempt limits or 2FA
- refresh token, access token or challenge token forgery or reuse
- account enumeration through responses or timing
- leaks of secrets, password hashes, codes or 2FA secrets through responses or logs
- injection, SSRF, or crashes triggered by request input

Out of scope:

- vulnerabilities in dependencies with no demonstrated impact on this project (report them upstream; Dependabot keeps them updated)
- issues that require a compromised server, database or `ENCRYPTION_KEY`
- missing hardening on deployments that changed the defaults (e.g. disabled rate limits)
- denial of service through traffic volume alone
- social engineering

## Security Design

The measures already in place (Argon2id hashing, lockout, hashed single-use codes, rotating refresh tokens with reuse detection, encrypted 2FA secrets, and more) are described in the [Security Notes](README.md#security-notes) section of the README.
