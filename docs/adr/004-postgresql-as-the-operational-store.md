# ADR-004: PostgreSQL as the operational store

- **Status:** Accepted — implemented
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

Scheduling data is relational and needs transactions and constraints.

## Decision

PostgreSQL 16 with EF Core migrations. Normalised tables; totals are derived, never stored twice. One exception, recorded here: a block's `PlannedMinutes` is stored, because under ADR-008 it depends on the time zone at the moment of scheduling and must not change later.

## Alternatives rejected

A document database; storing dashboards as denormalised tables.

## Consequences

Indexes follow query shapes: blocks by (user, date), tasks by (user, status), outcomes unique on (user, date, rank).

## Implementation state

Implemented. Not yet: query plans checked against representative data volumes.
