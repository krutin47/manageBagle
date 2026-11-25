# ADR-013: Focus timer state lives on the server

- **Status:** Accepted — in build
- **Date:** 2026-11-25
- **Source:** Phase 2 product requirements, P2-B

## Context

People press play on a block and expect the time to be recorded, even if they reload, close the tab
or pick up their phone. Only one block may run at a time.

## Decision

A block stores `TimerStartedAt` (UTC instant while running, null otherwise), `TrackedSeconds`
(time accumulated over earlier runs) and `ExtendedMinutes` (extra time granted at "time's up").
Elapsed time is always `TrackedSeconds + (now − TimerStartedAt)`, computed by whoever displays it;
nothing ticks on the server. A partial unique index on `(UserId) WHERE TimerStartedAt IS NOT NULL`
makes "one running timer per account" a database fact, not just a screen rule. Pausing or stopping
writes the tracked time into `ActualMinutes`. Responses carry the server's clock so the client can
correct for a device clock that is off.

## Alternatives rejected

A timer kept only in the browser (lost on reload, invisible on a second device); a separate
`FocusSession` table per run (more history than the product needs today — can be added later without
changing the API).

## Consequences

Extending a block at "time's up" does not move its planned end, so plan-versus-reality stays honest:
the overrun shows as variance. Recorded instants are UTC (ADR-008).
