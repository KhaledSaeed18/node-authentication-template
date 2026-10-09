# 0001. Modular monolith with explicit composition

**Status:** Accepted

## Context

The original code had one large service class, controllers that matched on error message strings, and a `PrismaClient` created inside the service. It was hard to test without a real mail provider and hard to extend without touching everything.

## Decision

- Organize the code by feature (`modules/auth`, `users`, `audit`, `outbox`, `keys`, `health`, `maintenance`), each with routes, controller, service and schemas.
- Controllers only translate HTTP; services hold the logic, receive dependencies through their constructor and throw typed `AppError`s with stable codes.
- Wire everything in one composition root, `buildApplication()`, which accepts overrides (mailer, database, key store, health state).
- No dependency injection container: plain constructors are enough at this size and keep the wiring readable.

## Alternatives considered

- **Microservices** (separate token, user and mail services): more moving parts and network failure modes for no benefit at this scale.
- **A DI framework** (tsyringe, InversifyJS, NestJS): decorators and reflection for wiring that fits in one file.

## Consequences

- Tests build the real application with an in-memory mailer and a real database, so they cover routing, validation and error handling too.
- Modules can be extracted later along the same boundaries if one of them needs to scale differently.
- The composition root grows with every module; that is a deliberate, visible cost.
