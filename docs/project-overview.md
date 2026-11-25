# manageBagle — project overview

Last updated: 2026-11-14 · Branch described: `feature/handbook-phase-1`

> The engineering standard for this project is the *Production Architecture Handbook*
> (`docs/handbook/`). **[handbook-status.md](handbook-status.md) is the live list of what has been
> adopted and what is still open**; where it and this overview disagree, the status file wins.

This is the one-stop description of the project: what it is, how it is built, the standards the
code follows, what exists today, and what is still open. Deeper detail lives in the linked documents.

| For | Read |
|---|---|
| Running it locally | [README](../README.md) |
| Sign-in setup and security model | [authentication.md](authentication.md) |
| Configuration, hosting, branch protection | [deployment.md](deployment.md) |
| Colours, type, motion | [design-system.md](design-system.md) |
| The brain-dump design and its follow-ups | [plan-brain-dump.md](plan-brain-dump.md) |
| Binding decisions and how far each is built | [adr/](adr/README.md) |
| Phase 2 product requirements | [requirements/phase-2-product.md](requirements/phase-2-product.md) |
| Rules for anyone changing the code | [AGENTS.md](../AGENTS.md) |
| Release, rollback, backup, restore | [runbooks/](runbooks/) |
| The API contract | [api/openapi.json](api/openapi.json) |

---

## 1. What the app is

manageBagle is a personal time-blocking planner. It started as a web version of the
*Time-Blocking Command Center* spreadsheet and keeps that method:

1. **Brain dump** everything on your mind into the backlog (from any page).
2. **Plan my day**: choose from the backlog and **pick the three** outcomes with the highest value.
3. **Give them time** on the calendar, batching similar work.
4. **Track reality** — log the minutes each block really took.
5. **Review** the day and the week, and adjust.

Rules carried over from the spreadsheet:

- A block that ends before it starts runs past midnight.
- An empty "actual minutes" means *not recorded yet*, never zero.
- Every dashboard figure is derived from the time blocks; nothing is entered twice.

Each person's data is private to their account.

---

## 2. Tech stack

| Layer | Choice | Notes |
|---|---|---|
| API | **ASP.NET Core 10** (C#), minimal APIs | LTS release |
| Data access | **Entity Framework Core 10** with migrations | |
| Database | **PostgreSQL 16** | |
| Auth | **ASP.NET Core Identity**, cookie sessions | Google and Microsoft OAuth handlers, TOTP for MFA |
| Client | **React 19 + TypeScript**, built with **Vite** | |
| Server state | **TanStack Query** | caching, optimistic updates |
| Routing | **React Router** | |
| UI primitives | **Radix UI** (dialog, menu) | focus trapping, keyboard support |
| Drag and drop | **dnd-kit** (kanban); pointer events (calendar) | |
| Animation | **Motion** | honours reduced-motion |
| Icons / fonts | **Lucide**; Bricolage Grotesque, Geist, Geist Mono (self-hosted) | |
| Styling | Plain CSS with design tokens (CSS custom properties) | no CSS framework |
| Tests | **xUnit** + `WebApplicationFactory` (API); **Vitest** (client); **Playwright** (browser) | |
| Observability | JSON logs with trace ids; **OpenTelemetry** export (opt-in) | |
| Delivery | **Docker** (one image), **GitHub Actions** CI | |

### How it fits together

```
Browser ──HTTPS──▶ reverse proxy ──▶ one container (port 8080)
                                      ├─ ASP.NET Core API      /api/*
                                      ├─ built React app       everything else
                                      └─ PostgreSQL (separate service)
```

The API serves the compiled client, so the app is **same-origin**. That is a deliberate choice: it
allows a plain `HttpOnly` session cookie, needs no CORS, and keeps deployment to one unit. In
development, Vite serves the client and proxies `/api` to the API so behaviour matches production.

### Repository layout

```
client/
  src/
    components/     shared UI: buttons, fields, dialog, toasts
    features/       one folder per screen: today, planner, week, backlog, review, guide, settings, auth, shell
    lib/            api client, query hooks, time helpers, scheduler
    styles/         tokens.css (design tokens) + base, ui, shell, pages
server/
  src/ManageBagle.Api/
    Auth/           sign-in endpoints, email sender
    Data/           entities, DbContext, migrations, default data
    Features/       one file per area: areas, blocks, backlog, days, plan, week summary
    Infrastructure/ security middleware, helpers
  tests/ManageBagle.Api.Tests/
docs/               this folder
scripts/            protect-branches.sh
.github/            CI workflow, pull-request template
```

### Data model

| Entity | Holds |
|---|---|
| `AppUser` | account, display name (Identity adds logins, MFA keys, recovery codes) |
| `FocusArea` | a life area with a colour; used to group and batch work |
| `BacklogTask` | a captured task: estimate, priority, impact, due date, kind of work, outside flag, status |
| `TimeBlock` | time on the calendar: date, start, end, status, actual minutes; may link to a task |
| `DailyOutcome` | one of a day's top three; may link to a task |
| `DailyReview` | the three end-of-day answers |
| `DayTheme` | the primary focus for each weekday |

A top-three outcome, its block and its task are linked, so finishing one finishes the others.

---

## 3. Practices and coding standards

These describe what the code does today. New work should follow them.

### Security

- **Sessions**: encrypted `HttpOnly`, `SameSite=Lax` cookie; `Secure` outside development. Nothing
  is stored in `localStorage` except the theme choice.
- **CSRF**: every state-changing `/api` request needs the app's custom header, a same-site `Origin`,
  and an antiforgery token bound to the browser and account (ADR-006).
- **Email confirmation** before an account can sign in; registration does not reveal who has an account.
- **Lost updates**: tasks and blocks carry a version; a stale edit gets 409, never a silent overwrite.
- **Data isolation**: every query filters by the signed-in user's id, and ids supplied by the client
  (focus area, task) are checked for ownership before use. Tests assert one user cannot read, edit
  or attach to another's data.
- **Passwords**: 10-character minimum; five failures lock the account for 10 minutes.
- **MFA**: TOTP with ten single-use recovery codes. Turning it off, regenerating codes and deleting
  the account require the password or a code again.
- **External sign-in**: an outside identity is attached only by creating a new account or by the
  signed-in owner linking it after step-up; a matching email alone never links (ADR-007).
- **Account enumeration**: password reset answers identically whether or not the account exists.
- **Rate limiting** on auth endpoints; **security headers** including a Content-Security-Policy with
  no inline or third-party scripts.
- **Secrets** come from environment variables or user-secrets, never from committed files.

### API

- Minimal APIs, grouped one file per feature, each exposing a `Map…Endpoints` extension.
- Request and response types are C# `record`s; entities are never returned directly.
- Validation: data annotations for shape, explicit checks for rules; failures return
  RFC 7807 problem details with field-level errors.
- Enums are stored and sent as strings, so the database and JSON stay readable.
- Dates and times are civil (`DateOnly` / `TimeOnly`) plus the account's IANA zone; durations are
  elapsed minutes, so DST is handled (ADR-008).
- Errors are RFC 9457 problem documents with a stable `code` and a `traceId` (ADR-005).
- Multi-step saves happen in one `SaveChanges` so they are all-or-nothing.
- Schema changes go through EF Core migrations only; they apply on startup by default.
- Nullable reference types are on, and CI builds with **warnings as errors**.
- Comments explain *why* (a rule, a trade-off), not what the next line does.

### Client

- TypeScript `strict`, with unused locals and parameters as errors.
- One folder per feature; shared pieces live in `components/` and `lib/`.
- All server access goes through `lib/api.ts` (one fetch wrapper, one error type) and the hooks in
  `lib/queries.ts`. Components do not call `fetch`.
- Quick actions (ticking, dragging) update **optimistically** and roll back if the server refuses.
- Logic with rules — time maths, calendar layout, day-fitting — is written as pure functions with
  unit tests, separate from the components.
- ESLint with the TypeScript and React Hooks rule sets; no disabled rules.
- Route-level code splitting where it pays (Settings carries the QR generator).

### Design and accessibility

- All colours come from tokens in `client/src/styles/tokens.css`; components never hard-code a colour.
- **WCAG 2.2 AA is tested**: `contrast.test.ts` reads the real token file and checks every
  text/background pairing in light and dark. Changing a token that breaks contrast fails the build.
- Colour is never the only signal: status has an icon and a word, focus areas show their name.
- Everything is reachable by keyboard with a visible focus ring; dialogs trap focus and close on Escape.
- Every drag action has a non-drag route (edit dialog, keyboard moves on the board).
- Motion is short and explains a change; `prefers-reduced-motion` turns it off.
- Layout adapts at 860 px (sidebar becomes a bottom bar; the week calendar shows one day).
- Wording: plain, sentence case, errors say what went wrong and what to do.

### Testing

- **API**: integration tests boot the real application against a throwaway PostgreSQL database —
  no mocked data layer. Unit tests cover the week-summary maths.
- **Client**: unit tests for time helpers, calendar layout, the day-fitting scheduler and contrast.
- Tests are written against behaviour ("a plan is all or nothing"), not implementation.
- **Browser**: Playwright drives the real API and client through the day plan, moving work and accounts.
- Current count: **139 API tests, 237 client tests, 16 end-to-end tests**, all passing locally.

### Git and delivery

- Flow: `feature/*` → `dev` → `uat` → `main`, by pull request. `main` is production.
- CI runs on every pull request to those branches: client lint, type-check, tests and build; server
  build and tests against PostgreSQL; container build.
- Commit messages: imperative subject, a body explaining why.
- Dependencies are pinned to exact versions on the server and locked on the client.

---

## 4. Features built so far

### Accounts and sign-in
- Register and sign in with email and password; "keep me signed in".
- Sign in with **Google** and **Microsoft** (each appears once its credentials are configured).
- **Two-step verification** with an authenticator app: QR setup, manual key, recovery codes (copy,
  download, regenerate), "don't ask again on this device".
- Forgot / reset password by emailed link.
- Change password, or set one on an account created through Google or Microsoft.
- Edit display name; delete account and all its data.
- New accounts start with eight focus areas and seven day themes, all editable.

Capturing, planning and pre-planning are three separate jobs (requirements P2-E):

### Brain dump (every page)
- A button in the navigation opens it anywhere. It only **captures**: each line becomes a backlog
  task; nothing is booked and no top three is chosen. One all-or-nothing save (`POST /api/backlog/capture`).
- Per task: length, kind of work, focus area, outcome impact, due date (priority follows it),
  recovery break, outside-work flag. Sort by topic, impact or due date.
- A pasted list becomes one task per line; a line that repeats an open backlog task is pointed out.
- The unsaved list survives closing the dialog and reloading the tab (this device only).

### Today
- **Plan my day**: choose from the backlog (overdue and due this week first, then high impact, then
  the rest), type in anything new, pick the top three ("Suggest for me" ranks by impact, then due
  date), and fit them around routines, meetings and existing blocks. Batches by focus area; pads
  outside work by 25 % (min 10 min); what does not fit stays in the backlog. Saved in one request.
- **Now**: the block that is running, happening now, or next, with its timer and what comes after.
- **Top three, rolling**: the open outcomes in rank order; when one is finished or dropped, the next
  task in line moves up (by priority, then start time). Finished and dropped items move to
  "Done for the day", each one click from being reopened.
- **The board follows**: starting a timer or a block moves its card to In progress; putting it off
  returns it to To do, unscheduled; finishing all its sessions moves it to Done; dropping it to Dropped.
- **Schedule**: the day's blocks with status menu, actual minutes, variance, and a "now / next" marker.
- **Due soon**: unbooked tasks that are overdue or due within 7 days, with "Add to today".
- Day totals: planned, logged, deep focus, blocks done. Day theme shown in the header.
- Move between days; empty days show a single invitation to plan the day.

### Routines (pre-planning)
- Fixed daily schedule: routines with weekdays, times, and whether tasks may go inside (none, any,
  or selected focus areas). One-click templates: Lunch, Dinner, Workout, Work hours, Wind-down.
- Recovery breaks per focus area, before or after each task.
- The day window, the drink-water reminder, meal reminders and browser-notification permission.

### Planner
- Week **calendar** with overlapping blocks side by side, a current-time line, per-day totals.
- Click an empty slot to create; **drag a block** to another time or day (mouse and pen).
- **List** view with the spreadsheet's columns, including planned, actual and +/−.
- Block editor: date, start, end, quick lengths, focus area, priority, kind of work, outside flag,
  status, actual minutes, notes; overnight blocks supported.
- One-day view with a day strip on phones.
- Recovery breaks before and after blocks, routines (protected or open) and meetings, in your chosen
  colours, with a key; the list view shows each block's breaks.
- A block placed over protected time or a meeting is allowed but flagged (editor, Today, Planner).

### Week
- Totals: planned, logged, deep-focus hours, blocks done %.
- Daily scorecard with planned-vs-logged bars; each row opens that day.
- Time by life area with share of plan.
- Editable day themes, saved as you leave a field.

### Backlog
- Quick capture box.
- **Kanban board** (To do, In progress, Done, Dropped): drag by mouse or keyboard.
- List view with filters (open, scheduled, closed, all) and delete with undo.
- Task editor with all fields; **Schedule** turns a task into a block.
- Remaining estimated hours; overdue and high-impact markers.
- Shows open tasks and 30 days of finished and dropped ones; "Show all history" for the rest.

### Review
- Optional end-of-day page: how the day went (top three, what ran over) and three questions.

### Settings and guide
- Focus areas: add, rename, recolour, delete (their blocks and tasks are kept).
- Sign-in and security management; light and dark theme.
- **Your data**: download everything the account holds as one JSON file (secrets left out).
- Guide: the daily loop and recommended block sizes.

### Platform
- Light and dark themes, responsive down to phone width.
- Health endpoint, single Docker image, docker-compose for local use, CI workflow.

---

## 5. What is pending

The detailed, phase-by-phase list is **[handbook-status.md](handbook-status.md)**. Everything that can
be done in code is done; what is left needs a decision or an account only the owner can provide.

### Needs your decision or action
| Item | Why |
|---|---|
| **Hosting for UAT and production** (and access for deploys) | Nothing is deployed. Unblocks: trusted proxy settings, host rate limits, a real restore drill, rolling-deploy draining, signed images. |
| **Email provider** (SMTP settings) | New accounts must confirm their email. |
| **Google and Microsoft credentials** | Sign-in buttons stay hidden until set; also needed for writing into Google Calendar. |
| **Protect `main` and `uat`** | Needs repository-admin rights: `scripts/protect-branches.sh` or GitHub settings. |
| **Error monitoring backend** | Telemetry export is wired but points nowhere. |
| **Container registry** | To publish and sign release images. |
| **Expected peak users** | To agree response-time objectives ([performance.md](performance.md)). |
| **Retention periods** | Proposed in [data-inventory.md](data-inventory.md): activity 13 months, backups 35 days, logs 30 days. |
| **AI brain dump** (paragraph, voice, photo) | Needs a model provider, a budget and a privacy stance (ADR-012). |
| **Notifications while the app is closed** | Needs Web Push: a service worker, keys and a background sender. Worth building? |
| **Prettier** | Adopting it reformats every file in one change. |

### Blocked by tooling
- Accessibility lint (`eslint-plugin-jsx-a11y`) does not support ESLint 10 yet (checked 2026-11-25).

### Not verified yet
- Anything on a deployed environment; real phones and screen readers; real Google/Microsoft
  sign-in and real Google/Outlook calendar feeds (tested against stand-ins).
