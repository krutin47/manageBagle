# Handbook adoption status

Tracks the *Production Architecture Handbook* (`docs/handbook/`) roadmap against what is actually in
the repository. Last updated: 2026-11-25 (branch `feature/capture-plan-preplan`).

Product features requested for Phase 2 are specified in
[requirements/phase-2-product.md](requirements/phase-2-product.md) and tracked at the end of the Phase 2 section.

Legend: **Done** = built and covered by a test that was run · **Partial** = some of it built, the
gap is stated · **Not done** = nothing built · **Needs you** = cannot be done from code.

## Phase 0 — verified baseline

| Item | State | Evidence |
|---|---|---|
| Client lint, type-check, tests, build | Done | run locally, all pass |
| Server build (warnings as errors) and tests against real PostgreSQL | Done | 171 tests pass |
| Migrations against a disposable database | Done | every test run creates a database from migrations; release sequence run by hand |
| Build the Docker image and run it | Done in CI | the `image` job builds it, checks it runs as non-root, is not ready before migrations, migrates, serves the app with security headers; green on `dev` |
| Trace five user journeys with timings and SQL counts | Done | SQL counts per journey held to budgets by `QueryBudgetTests`; timings from the load test ([performance.md](performance.md)) |
| Review auth endpoints, auto-link, CSRF, cookies, proxy, key ring, ownership | Done | findings became the Phase 1 work below; see `docs/baseline.md` |

## Phase 1 — production safety foundations

| # | Item | State | Notes |
|---|---|---|---|
| 1 | Email confirmation at registration | Done | accounts cannot sign in until confirmed; registration and resend do not reveal whether an address exists |
| 1 | Safe recovery | Done | reset links are one-time and expire in 2 h. Lost every second factor: self-service recovery confirmed by email, then a 72-hour wait the owner can cancel; every step audited (`/mfa-recovery`) |
| 1 | Remove destructive auto-linking | Done | ADR-007; existing accounts marked confirmed by migration so nobody is locked out |
| 2 | Antiforgery tokens | Done | ADR-006 |
| 2 | Trusted ingress headers | Done in code · **Needs you** | only loopback is trusted by default. Set `ForwardedHeaders__KnownProxies` / `KnownNetworks` to your platform's ingress when you deploy |
| 2 | Tests for CSRF, spoofed headers, cross-account writes | Done | `SecurityTests`, `TransportTests`, `PlanningTests` |
| 3 | Problem Details and trace IDs | Done | ADR-005 |
| 3 | Sanitised structured logs | Done | JSON outside development; route templates, not URLs; no bodies |
| 3 | Central error monitoring | Done in code · **needs the Sentry DSN** | Sentry (ADR-018): server errors and browser errors, no personal data (tested with a stand-in Sentry). Previously: | traces and metrics export over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; browser errors are reported to the server log with the reference the person sees. **No backend chosen or connected, no alerts.** |
| 4 | User time-zone setting | Done | ADR-008 |
| 4 | DST and overnight policy | Done | tested on both transitions |
| 4 | Migrate without changing existing dates | Done | old rows keep their wall-clock length and get no zone |
| 5 | Optimistic concurrency on task and block writes | Done | ADR-011 |
| 5 | Atomic plan and simultaneous edits tested | Done | 8 concurrent writers: exactly one wins |
| 6 | Migrations as an explicit release step | Done | `--migrate`; readiness fails until applied |
| 6 | Backups and a restore drill | Partial | `scripts/backup.sh`, `scripts/restore-drill.sh`; drill passed **against a local database only**. No production backups exist because no production exists. |
| 7 | Playwright end-to-end flows | Done | 20 tests, run locally against the production build and in CI |
| 7 | Verify the full Docker / UAT deployment | **Not done** | no image has been built, no environment exists |

**Also done in Phase 1:** a queryable audit trail shown to the owner (Settings → Account activity); other sessions now end within 60 s of a password change or reset (`Auth__SessionRevalidateSeconds`), instead of Identity's 30-minute default.

**Exit criteria**

| Criterion | Met? |
|---|---|
| Security test suite passes | Yes |
| Sessions persist across deployments | Demonstrated locally: a session survived restarting an instance, and worked across two instances ([performance.md](performance.md)). Not yet on a deployed environment |
| A tested backup restore succeeds | Locally only |
| An ordinary user can complete the day-plan flow after a new release | Locally, in the E2E suite; not on a deployed release |

## Phase 2 — architecture and maintainability

| Item | State | Notes |
|---|---|---|
| Application/use-case boundary for PlanDay, TimeBlock/Finish, Tasks/ChangeStatus | Done for the named use cases | `PlanDay`, `CaptureTasks`, `FocusTimer` (finishing blocks), `ChangeTaskStatus` (board → blocks and outcomes), `CalendarSync`; typed `Result`; architecture test. Plain create/read/update endpoints for areas, themes and reviews still use `DbContext` directly — see the next-but-one row |
| Pure domain time logic | Done | `Domain/CivilTime.cs` |
| Task lifecycle; no false completion of multi-session tasks | Done | `Domain/TaskCompletion.cs` |
| Built-in OpenAPI | Done | ADR-002 |
| Per-endpoint metadata | Done | every `/api` endpoint declares its success response; `EndpointMetadataTests` fails otherwise. Auth responses are named records (same JSON as before) |
| Generated TypeScript contracts | Done | ADR-016: `npm run gen:api` generates types from the contract (no new dependency); a test fails if they are stale; `contract.check.ts` fails the type check if a hand-written type drifts. It found one real drift (`Outcome.backlogTaskId`), now fixed |
| Contract diff in CI | Done | committed snapshot + test |
| Move endpoint EF access into application/infrastructure | Partial | every endpoint with a business rule now goes through a use case. Simple CRUD (areas, themes, reviews, outcomes) still queries `DbContext` in the endpoint; moving it would add layers without changing behaviour, so it is left until one of them gains a rule |
| Feature import rules | Done | ESLint: `lib/` and `components/` import no feature; the building blocks `capture/` and `timer/` import no page; pages do not import each other (the Planner's block editor is the one shared exception). A capture ↔ today cycle was removed. Verified by deliberately violating each rule |
| Formatting and analyzers | Done except accessibility lint | `.editorconfig`, warnings as errors, `noUncheckedIndexedAccess`, Prettier with a CI check (ADR-021). **`eslint-plugin-jsx-a11y` is blocked:** it does not yet support ESLint 10 (checked 2026-11-25) |
| Dependency vulnerability scans | Done in CI definition | `npm audit`, `dotnet list package --vulnerable`; CI has not run yet |
| Signed release artifact, SBOM | Partial | SBOM (SPDX, from BuildKit) generated and uploaded by CI — verified on `dev` (519 KB artifact). Signing needs images published to a registry: **needs you** |
| Route lazy loading | Done | every page except Today, including sign-in. First download 755 → 661 KB (236 → 211 KB gzip); measurements in performance.md |
| Targeted stale times, key factory, request cancellation | Done | ADR-003 |
| Architecture dependency test | Done | `ArchitectureTests` |

### Phase 2 — product (requirements in [requirements/phase-2-product.md](requirements/phase-2-product.md))

| ID | Item | State | Notes |
|---|---|---|---|
| P2-A1–A7 | Brain dump: priority from due date, deep focus = 2 h, area as tag, working sort modes, distinct suggestion chips, one row of options, outside-work icon | Done | rules in `features/today/brainDump.ts` (21 unit tests); browser test covers A1, A2, A4, A7 |
| P2-B1–B5 | Focus timer: play/pause/stop, one at a time, time recorded, time's-up prompt, stop reasons | Done | ADR-013; 12 API tests (incl. a five-way start race), 3 browser tests; drop notes shown on Review |
| P2-C1–C3 | Routines with task policies; fitting respects them and a day window | Done | ADR-014; server refuses plans that break a routine; 5 domain + 5 API tests, fitter tests, 1 browser test |
| P2-C4 | Recovery breaks per focus area and per task | Done | reserved on the block, shown on Today and the calendar |
| P2-C5 | Water, meal and time's-up reminders | Done | in-app toast; with notifications turned on, also while the app is closed (Web Push, ADR-019): encryption verified against RFC 8291, sending once across instances tested. Delivery through a real browser push service is not testable here |
| P2-D1 | Calendar export (subscription feed and .ics) | Done | ADR-015; private regenerable link, titles and times only; browser test |
| P2-D2 | Read busy time from an existing calendar | Done | ADR-015; SSRF-safe fetch (13 URL + 15 address tests), recurring meetings expanded, plan refuses to book over meetings; tested against a stub server — **not yet against a real Google or Outlook calendar** |
| P2-D3 | Write into Google Calendar, two-way sync | Phase 3 | needs Google OAuth credentials |
| P2-E1–E3 | Separate brain dump (capture), Plan my day, and a Routines page | Done | capture endpoint is all-or-nothing (API tests); suggestions and duplicate detection are pure functions (client tests); browser tests for capture, plan and routines |
| P2-F1–F2 | Today: "now" and a rolling top three | Done | `rollingTopThree` pure function with tests; browser test finishes #1 and sees the next move up |
| P2-G1 | Board columns follow what happens on Today | Done | `TaskCompletion.AfterSessionChanged` (domain tests); timer start, block status and outcome tick/drop (API tests) |
| P2-H1 | Calendar shows breaks before and after, routines, meetings, with a legend | Done | browser test checks routine label, break, key and list view |
| P3-AI1–AI2 | Brain dump from a paragraph or by voice | Done · **needs the API key** | ADR-020: suggestions only, schema-constrained, checked again by the server; US$10 monthly cap and daily limit (tested with a stand-in model; browser test with a scripted one). Not yet run against the real API: no key here |
| P3-AI3 | Brain dump from a photo | Not started | not requested in this round |

## Phase 3 — reliability and capacity

| Item | State | Notes |
|---|---|---|
| Workload simulation with p95/p99, DB connections, memory, request rate | Done locally | `scripts/load/run.mjs`; results in [performance.md](performance.md). One machine, not a deployment |
| Fix highest-cost query patterns and unbounded results | Done | connection exhaustion fixed (bounded pool), busiest route 5 → 3 queries, query budgets per journey. The backlog returns open tasks plus 30 days of closed ones (`history=all` for the rest); blocks and commitments are limited to 62 days |
| Ingress and global rate limits | Partial | per-account limit on every API call (`RateLimits__RequestsPerMinute`), tested. Ingress limits depend on the host: **needs you** |
| Two-replica environment: shared keys, session continuity, trusted proxies | Done locally · draining not checked | `scripts/load/two-instances.mjs`, six checks pass. Graceful draining needs a real load balancer |
| Queue or worker for measured costly work | Not needed yet | nothing measured is slow enough; reminders run in the browser |
| AI classification and estimation | Not started | P3-AI1–AI3, ADR-012; needs a model provider and budget decision from you |
| Agreed SLOs, tested rollback, alerts and runbooks | Partial | objectives agreed for about 100 people (performance.md); Sentry alerts on errors once its DSN is set. Rollback and an uptime check need the deployed environment |

## Handbook requirements not yet met anywhere

- No `/api/v1` prefix (deferred to the first breaking change, per §7.1).

Closed on 2026-11-25:

- Fixed commitments (§1): planning refuses to book over a protected routine or meeting; a block
  placed there by hand is allowed but flagged with an icon and words in the editor, on Today and in
  the Planner.
- Bounded collections (§7.1): see Phase 3 above.
- Recurrence in civil time (§10): routines are the recurring items; their clock time is tested
  across a daylight-saving change (`RoutineTests`).
- Actual start and finish instants (§10): recorded on every block however its status changes,
  returned by the API, included in the export.
- Data inventory, retention and export (§17.3): [data-inventory.md](data-inventory.md); "Download my
  data" in Settings; audit retention is configurable (`Retention__AuditMonths`).
