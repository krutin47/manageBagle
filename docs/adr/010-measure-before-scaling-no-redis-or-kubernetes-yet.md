# ADR-010: Measure before scaling; no Redis or Kubernetes yet

- **Status:** Accepted
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

Infrastructure added on a guess costs money and attention.

## Decision

Run one replica behind managed TLS ingress with managed PostgreSQL. Add replicas, caches or queues only on measured need. The app is already stateless across replicas (cookie keys in the database).

## Alternatives rejected

Kubernetes, Redis and a message broker from day one.

## Consequences

The in-process rate limiter is per replica; with more than one replica, limits move to the ingress.

## Implementation state

Nothing to build. Not yet: load test, hosting choice.
