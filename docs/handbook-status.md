# Handbook adoption status

Tracks the *Production Architecture Handbook* (`docs/handbook/`) roadmap against what is actually in
the repository. Branch: `feature/handbook-phase-1`. Last updated: 2026-11-14.

Product features requested for Phase 2 are specified in
[requirements/phase-2-product.md](requirements/phase-2-product.md) and tracked at the end of the Phase 2 section.

Legend: **Done** = built and covered by a test that was run · **Partial** = some of it built, the
gap is stated · **Not done** = nothing built · **Needs you** = cannot be done from code.

## Phase 0 — verified baseline

| Item | State | Evidence |
|---|---|---|
| Client lint, type-check, tests, build | Done | run locally, all pass |
| Server build (warnings as errors) and tests against real PostgreSQL | Done | 76 tests pass |
| Migrations against a disposable database | Done | every test run creates a database from migrations; release sequence run by hand |
| Build the Docker image and run it | **Not done** | no Docker daemon where this was built; CI job `image` does it on the first pull request |
| Trace five user journeys with timings and SQL counts | **Not done** | no measurements taken yet |
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
| 3 | Central error monitoring | Partial | traces and metrics export over OTLP when `OTEL_EXPORTER_OTLP_ENDPOINT` is set; browser errors are reported to the server log with the reference the person sees. **No backend chosen or connected, no alerts.** |
| 4 | User time-zone setting | Done | ADR-008 |
| 4 | DST and overnight policy | Done | tested on both transitions |
| 4 | Migrate without changing existing dates | Done | old rows keep their wall-clock length and get no zone |
| 5 | Optimistic concurrency on task and block writes | Done | ADR-011 |
| 5 | Atomic plan and simultaneous edits tested | Done | 8 concurrent writers: exactly one wins |
| 6 | Migrations as an explicit release step | Done | `--migrate`; readiness fails until applied |
| 6 | Backups and a restore drill | Partial | `scripts/backup.sh`, `scripts/restore-drill.sh`; drill passed **against a local database only**. No production backups exist because no production exists. |
| 7 | Playwright end-to-end flows | Done | 11 tests, run locally |
| 7 | Verify the full Docker / UAT deployment | **Not done** | no image has been built, no environment exists |

**Also done in Phase 1:** a queryable audit trail shown to the owner (Settings → Account activity); other sessions now end within 60 s of a password change or reset (`Auth__SessionRevalidateSeconds`), instead of Identity's 30-minute default.

**Exit criteria**

| Criterion | Met? |
|---|---|
| Security test suite passes | Yes |
| Sessions persist across deployments | By design (key ring in the database); **not yet demonstrated** by restarting a deployed instance |
| A tested backup restore succeeds | Locally only |
| An ordinary user can complete the day-plan flow after a new release | Locally, in the E2E suite; not on a deployed release |

## Phase 2 — architecture and maintainability

| Item | State | Notes |
|---|---|---|
| Application/use-case boundary for PlanDay, TimeBlock/Finish, Tasks/ChangeStatus | **Not done** | endpoints still orchestrate and use `DbContext` directly |
| Pure domain time logic | Done | `Domain/CivilTime.cs` |
| Task lifecycle; no false completion of multi-session tasks | Done | `Domain/TaskCompletion.cs` |
| Built-in OpenAPI | Done | ADR-002 |
| Per-endpoint metadata | Partial | blocks and plan declare responses; other endpoints infer them |
| Generated TypeScript contracts | **Not done** | client types are hand-written |
| Contract diff in CI | Done | committed snapshot + test |
| Move endpoint EF access into application/infrastructure | **Not done** | |
| Feature import rules | **Not done** | no ESLint boundary rule yet |
| Formatting and analyzers | Partial | `.editorconfig`, warnings as errors. No Prettier, no `jsx-a11y`, `noUncheckedIndexedAccess` not enabled |
| Dependency vulnerability scans | Done in CI definition | `npm audit`, `dotnet list package --vulnerable`; CI has not run yet |
| Signed release artifact, SBOM | **Not done** | |
| Route lazy loading | Partial | Settings only |
| Targeted stale times, key factory, request cancellation | Done | ADR-003 |
| Architecture dependency test | Done | `ArchitectureTests` |

### Phase 2 — product (requirements in [requirements/phase-2-product.md](requirements/phase-2-product.md))

| ID | Item | State | Notes |
|---|---|---|---|
| P2-A1–A7 | Brain dump: priority from due date, deep focus = 2 h, area as tag, working sort modes, distinct suggestion chips, one row of options, outside-work icon | Not started | |
| P2-B1–B5 | Focus timer: play/pause/stop, one at a time, time recorded, time's-up prompt, stop reasons | Not started | ADR-013 |
| P2-C1–C3 | Routines with task policies; fitting respects them and a day window | Not started | ADR-014 |
| P2-C4 | Recovery breaks per focus area and per task | Not started | ADR-014 |
| P2-C5 | Water and meal reminders (app open) | Not started | Push when the app is closed: Phase 3 |
| P2-D1 | Calendar export (subscription feed and .ics) | Not started | ADR-015 |
| P2-D2 | Read busy time from an existing calendar | Not started | ADR-015 |
| P2-D3 | Write into Google Calendar, two-way sync | Phase 3 | needs Google OAuth credentials |

## Handbook requirements not yet met anywhere

- Overlapping fixed commitments are neither rejected nor reconciled; blocks may overlap freely (§1 invariants).
- Collections are not paginated (backlog returns all tasks; blocks are bounded to 62 days) (§7.1).
- No `/api/v1` prefix (deferred to the first breaking change, per §7.1).
- No recurring blocks, so the civil-time recurrence rule is untested (§10).
- Actual start/finish instants are not recorded, only minutes (§10).
- No data inventory, retention policy or export path (§17.3).
- No load test, no SLO measurement (§1, Phase 3).
