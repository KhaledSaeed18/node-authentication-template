## Summary

<!-- What does this change and why? Link the issue it resolves. -->

Closes #

## Type of change

- [ ] Bug fix
- [ ] New feature
- [ ] Refactor (no behavior change)
- [ ] Documentation
- [ ] Tooling, CI or dependencies
- [ ] Breaking change (API, configuration or database)

## How was it tested?

<!-- New or updated tests, and anything you checked by hand (requests, Docker, emails in Mailpit, ...). -->

## Checklist

- [ ] `yarn lint`, `yarn typecheck`, `yarn build` and `yarn test` pass locally
- [ ] Tests cover the new or changed behavior
- [ ] Commits follow the [commit conventions](https://github.com/KhaledSaeed18/node-authentication-template/blob/main/CONTRIBUTING.md#commit-messages)
- [ ] Docs updated where needed (README, `.env.example`, OpenAPI document in `src/docs/openapi.ts`, CHANGELOG for breaking changes)
- [ ] Schema changes come with a migration (`yarn db:migrate --name <change>`)

## Security

- [ ] No secrets, tokens or personal data in code, tests, logs or responses
- [ ] Responses don't reveal whether an account exists, where that matters
- [ ] New endpoints are rate limited, validated, and authenticated when they need to be

<!-- If this touches authentication, sessions, tokens or 2FA, describe the risks you considered. -->
