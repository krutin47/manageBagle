# ADR-001: Modular monolith with incremental clean boundaries

- **Status:** Accepted — in progress
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

One deployable unit is the cheapest thing to run and reason about for a personal planner. The risk is a codebase where HTTP, database and business rules blur together.

## Decision

Stay a single ASP.NET Core application. Organise by business capability (Accounts, Tasks, Planning, Calendar, Review, Analytics). Business rules live in `Domain/` with no dependency on HTTP, EF Core or Identity; endpoints stay thin. Physical projects (Application, Domain, Infrastructure) are introduced only when a boundary needs enforcing by the compiler.

## Alternatives rejected

Microservices now (operational cost with no benefit at this scale); a generic repository over EF Core (hides the unit of work and adds indirection).

## Consequences

A dependency test (`ArchitectureTests`) fails the build if `Domain` references web or persistence namespaces. Endpoints still talk to `DbContext` directly; use-case classes are extracted slice by slice, PlanDay first.

## Implementation state

Implemented: `Domain/` namespace (CivilTime, TimeZones, TaskCompletion) and the dependency test. Not yet: separate Application project; PlanDay as a use-case class.
