# ADR-014: Routines are rules, expanded on read

- **Status:** Accepted — implemented
- **Date:** 2026-11-25
- **Source:** Phase 2 product requirements, P2-C

## Context

Routines (lunch, workout, work hours) repeat on chosen weekdays. They must show on any day the person
looks at, feed the brain-dump fitting, and repeat in civil time across daylight-saving changes.

## Decision

A routine is stored once, as a rule: title, weekdays, civil start and end, a task policy (*no tasks*,
*any task*, *selected focus areas*), and whether it is a meal. Occurrences are **expanded on read** by
a pure domain function for the requested date range, in the account's time zone, using ADR-008's
policy (a start that falls in a spring-forward gap moves to the next real time). The server returns
the expanded commitments; the client never expands rules itself, so there is one interpretation.

Recovery breaks are stored on the thing they belong to: a default on the focus area, an optional
override on the task, and the minutes actually reserved on the booked block (`BreakBeforeMinutes`,
`BreakAfterMinutes`). Moving a block moves its break. Breaks never count as planned work.

## Alternatives rejected

Materialising a row per occurrence (rows to clean up whenever a routine changes); breaks as separate
blocks (they would need to move with their task and be excluded from every total).

## Consequences

Routines are preferences for automatic planning, not hard locks: a person may still place a block by
hand over lunch, and the calendar shows the overlap.
