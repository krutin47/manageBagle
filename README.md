# manageBagle

Plan your day in time blocks, track what really happened, and review your week.
A web version of the *Time-Blocking Command Center* workbook.

| Workbook tab | In the app |
|---|---|
| START HERE | **Guide** – the daily loop and recommended block sizes |
| DAILY FOCUS | **Today** – brain dump, your top three, the day's schedule, what is due soon · **Review** – optional end-of-day review |
| TIME BLOCKS | **Planner** – week calendar or list; planned vs. actual minutes and variance |
| WEEKLY HQ | **Week** – totals, daily scorecard, time by life area, day themes |
| TASK BACKLOG | **Backlog** – kanban board or list; capture first, schedule second |
| SETTINGS | **Settings** – focus areas, plus profile, security and theme |

The workbook's formulas are kept: a block that ends before it starts runs past midnight, an
empty "actual minutes" means *not recorded* (never zero), and every dashboard number is derived
from the time blocks.

**New here? Start with [docs/project-overview.md](docs/project-overview.md)** — what the app is, how it is
built, the standards it follows, every feature so far, and what is still open.

## Stack

- **API** – ASP.NET Core 10 minimal APIs, EF Core, PostgreSQL 16, ASP.NET Core Identity
- **Client** – React 19 + TypeScript, Vite, TanStack Query, Radix primitives, Motion, Lucide icons
- **Delivery** – one container: the API serves the built client, so everything is same-origin

```
client/   React app            server/src/    API
docs/     auth, deploy, design server/tests/  API tests (real PostgreSQL)
```

## Run it locally

Needs .NET 10 SDK, Node 22 and Docker (for PostgreSQL).

```bash
docker compose up -d db
```

```bash
dotnet run --project server/src/ManageBagle.Api
```

```bash
cd client && npm install && npm run dev
```

Open http://localhost:5173. The dev server proxies `/api` to the API on port 5242, and the
database schema is created on first start. Password-reset emails are written to the API log
until SMTP is configured.

To run the production image instead: `docker compose --profile app up --build`, then open
http://localhost:8080.

## Tests

```bash
cd client && npm run lint && npm run typecheck && npm test
```

```bash
dotnet test server/ManageBagle.slnx
```

The client tests include the WCAG contrast checks for every colour pairing in both themes. The
API tests boot the real application against a throwaway PostgreSQL database (set
`MB_TEST_POSTGRES` to point at a different server).

## Sign-in

Email + password, Google, Microsoft, and two-step verification (authenticator app with recovery
codes). The Google and Microsoft buttons appear only once their credentials are configured.
Setup for both and for SMTP, and the security model, are in [docs/authentication.md](docs/authentication.md).

## Branches and releases

| Branch | Purpose | How code arrives |
|---|---|---|
| `feature/*` | one change | branched from `dev` |
| `dev` | integration | pull request from a feature branch |
| `uat` | release candidate for acceptance testing (protected) | pull request from `dev` |
| `main` | production (protected) | pull request from `uat` |

CI (`.github/workflows/ci.yml`) runs on every pull request to those three branches.
See [docs/deployment.md](docs/deployment.md) for configuration and branch protection.

## Design

Colour tokens, type and motion rules are described in [docs/design-system.md](docs/design-system.md).
The brain-dump flow and what is planned next are in [docs/plan-brain-dump.md](docs/plan-brain-dump.md).
