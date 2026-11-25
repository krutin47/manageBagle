# Architecture decision records

Decisions that are binding unless a later record supersedes them. Each states what was decided, what was rejected, and **how much of it is actually built** — a decision being accepted does not mean it is finished.

| # | Decision | Status |
|---|---|---|
| [001](001-modular-monolith-with-incremental-clean-boundaries.md) | Modular monolith with incremental clean boundaries | Accepted — in progress |
| [002](002-minimal-apis-with-built-in-openapi.md) | Minimal APIs with built-in OpenAPI | Accepted — implemented |
| [003](003-tanstack-query-owns-server-state-no-redux.md) | TanStack Query owns server state; no Redux | Accepted — implemented |
| [004](004-postgresql-as-the-operational-store.md) | PostgreSQL as the operational store | Accepted — implemented |
| [005](005-problem-details-and-a-single-exception-boundary.md) | Problem Details and a single exception boundary | Accepted — implemented |
| [006](006-cookie-sessions-with-real-antiforgery-tokens.md) | Cookie sessions with real antiforgery tokens | Accepted — implemented |
| [007](007-outside-identities-are-linked-only-by-the-signed-in-owner.md) | Outside identities are linked only by the signed-in owner | Accepted — implemented |
| [008](008-civil-time-an-account-time-zone-and-elapsed-durations.md) | Civil time, an account time zone, and elapsed durations | Accepted — implemented for one-off blocks |
| [009](009-one-immutable-image-promoted-through-environments.md) | One immutable image promoted through environments | Accepted — not yet implemented |
| [010](010-measure-before-scaling-no-redis-or-kubernetes-yet.md) | Measure before scaling; no Redis or Kubernetes yet | Accepted |
| [011](011-atomic-day-plan-and-optimistic-concurrency.md) | Atomic day plan and optimistic concurrency | Accepted — implemented |
| [012](012-ai-suggests-the-person-confirms-the-scheduler-decides.md) | AI suggests, the person confirms, the scheduler decides | Accepted — deferred |
| [013](013-focus-timer-state-lives-on-the-server.md) | Focus timer state lives on the server | Accepted — in build |
| [014](014-routines-are-rules-not-rows.md) | Routines are rules, expanded on read | Accepted — in build |
| [015](015-calendars-start-with-icalendar-feeds.md) | Calendar interoperability starts with iCalendar feeds | Accepted — in build; write-back in Phase 3 |
