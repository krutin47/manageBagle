# ADR-003: TanStack Query owns server state; no Redux

- **Status:** Accepted — implemented
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

Server data cached in two places drifts apart.

## Decision

TanStack Query is the only owner of server data. URL search params own navigation state (selected day, view). `useState` owns transient UI. Query keys come from one factory (`keys` in `lib/queries.ts`); stale times are set per kind of data; requests take the query's `AbortSignal`; the cache is cleared on sign-out.

## Alternatives rejected

Redux Toolkit alongside TanStack Query.

## Consequences

Reconsider only if complex client-only state appears that several distant components must coordinate.

## Implementation state

Implemented.
