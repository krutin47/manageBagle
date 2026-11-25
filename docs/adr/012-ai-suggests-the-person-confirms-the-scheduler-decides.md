# ADR-012: AI suggests, the person confirms, the scheduler decides

- **Status:** Accepted — deferred
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

AI rewriting and topic sorting were requested for later.

## Decision

When built: opt-in, a strict output schema, per-user cost caps, no task text sent without consent, and no model output written to the database without the person's confirmation and server-side validation. The planner must work fully without it.

## Alternatives rejected

Letting a model write tasks or calendar entries directly.

## Consequences

Until then, "topic" means the focus area the person chose.

## Implementation state

Not started, by decision.
