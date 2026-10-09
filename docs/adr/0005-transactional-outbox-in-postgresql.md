# 0005. Transactional outbox in PostgreSQL

**Status:** Accepted

## Context

Emails were sent from the request, fire-and-forget. A crash or a mail provider outage lost them, nothing was retried, and an email could go out for a change that was then rolled back.

## Decision

- Background work is written as an `OutboxMessage` row in the same transaction as the change that causes it.
- A worker claims due jobs with `UPDATE ... WHERE id IN (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING`, runs the handler, and marks the job done, or schedules a retry with exponential backoff (10 s doubling up to 15 min, with jitter). After 5 attempts the job is marked failed.
- Jobs left `PROCESSING` by a crashed worker are claimed again after a lock timeout.
- Payloads never contain secrets: the verification code is generated when the email is sent.
- Job types and payloads are declared per module and type-checked through TypeScript declaration merging.
- The worker runs in the API process by default and can run as separate processes.

## Alternatives considered

- **A message broker** (RabbitMQ, SQS) or **Redis-based queue** (BullMQ): another piece of infrastructure, and still not atomic with the database change without an outbox in front of it.
- **pg-boss**: a solid library for the same approach; a small dedicated worker keeps the mechanics visible and the dependency count down.

## Consequences

- Delivery is at least once: handlers must tolerate running twice.
- Email latency is up to the poll interval (1 s by default).
- Delivered jobs are pruned by the cleanup job after 7 days, failed ones after 30.
