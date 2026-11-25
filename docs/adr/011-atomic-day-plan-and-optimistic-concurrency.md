# ADR-011: Atomic day plan and optimistic concurrency

- **Status:** Accepted — implemented
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

A plan touches tasks, blocks and outcomes; a half-saved plan is worse than none. And the same account in two tabs must not silently overwrite itself.

## Decision

The plan is one request and one database transaction. An `Idempotency-Key` makes a repeat of the same plan return the first answer; reusing a key for a different plan is a 409. Tasks and blocks carry a `version`; every update must state the version it edited, and a stale one is refused with 409 `stale_version`. Two plans racing for the same day collide on a unique index and one is refused.

## Alternatives rejected

One HTTP call per task; last write wins.

## Consequences

The client reads the version at send time and runs writes to the same kind of record one after another, so quick successive edits do not conflict with themselves. **Multi-session rule:** finishing one block of a task that has other open blocks leaves the task in progress.

## Implementation state

Implemented, with tests for stale tabs, eight simultaneous writers, replays and racing plans.
