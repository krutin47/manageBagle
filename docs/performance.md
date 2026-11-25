# Performance and capacity (handbook Phase 3)

Status: first measurements, 2026-11-25 · Scripts: [`scripts/load/`](../scripts/load)

## How it was measured

`scripts/load/run.mjs` signs up real accounts (email confirmation included), gives each a planned
day and a 20-task backlog, then has every account use the app at once for 60 seconds, repeating a
weighted mix of journeys with a short pause between them:

| Journey | Weight | Requests |
|---|---|---|
| Open Today | 5 | me, day, week of blocks, backlog, commitments, timer, preferences — in parallel, as the page does |
| Open Planner | 2 | week of blocks, commitments, areas |
| Tick a block | 2 | today's blocks, then a status change |
| Brain dump | 1 | capture three tasks |
| Open Week | 1 | week summary |

Each simulated person starts a journey about every half second (about 1.8 journeys a second). A real
person starts perhaps one a minute while they use the app, so one simulated user is roughly a
hundred real people active at the same moment. That ratio is an estimate, not a measurement.

**Environment:** one machine with 4 cores and 16 GB, running the API (Release build), PostgreSQL 16
and the load generator together. They compete for the same CPU, so absolute numbers are pessimistic
and only comparisons between runs are meaningful. No real deployment has been measured.

```bash
BASE=http://localhost:5300 MAIL_DIR=<pickup dir> USERS=200 DURATION=60 node scripts/load/run.mjs
```

The server needs `RateLimits__AuthPerMinute` high enough for the sign-ups, and an SMTP pickup directory.

## What was found and fixed

At 200 simulated users the first run fell over: **202 errors**, throughput fell from 794 to 425
requests a second, and p95 latency reached 2–3 seconds. The server log showed PostgreSQL refusing
connections (`53300: remaining connection slots are reserved`). Npgsql's default pool (100) equals
PostgreSQL's default `max_connections` (100), so one busy instance could take every connection and
the rest failed outright instead of waiting.

Changes:

1. **Bounded pool per instance:** `Database__MaxPoolSize`, default 30, unless the connection string
   sets `Maximum Pool Size`. Requests now queue briefly for a connection instead of failing.
2. **Fewer queries on the busiest route:** `GET /api/commitments` (called by Today and the Planner)
   went from five queries to three — the account's zone and the routines were fetched twice.
3. **A per-account ceiling on API calls:** `RateLimits__RequestsPerMinute`, default 1200, so one
   runaway client cannot take everyone's capacity. Health checks are never limited.

## Results (p95 per journey, milliseconds)

| Journey | 50 users before | 50 users after | 200 users before | 200 users after | 200 after, p99 |
|---|---|---|---|---|---|
| Open Today | 33 | 57 | 2,683 | 517 | 709 |
| Open Planner | 26 | 50 | 2,666 | 513 | 715 |
| Tick a block | 44 | 83 | 3,245 | 620 | 794 |
| Brain dump | 27 | 52 | 1,968 | 453 | 609 |
| Open Week | 18 | 41 | 988 | 308 | 546 |

| | 50 before | 50 after | 200 before | 200 after |
|---|---|---|---|---|
| Requests / second | 794 | 777 | 425 | **1,551** |
| Errors | 1 | 0 | 202 | **0** |
| Peak DB connections | not recorded | 31 | not recorded | 31 |
| Peak API memory (RSS) | not recorded | 307 MB | not recorded | 368 MB |

The trade-off is visible at 50 users: with 30 connections instead of 100, p95 rose by 20–40 ms
because requests queue for a connection. At 200 users the same cap is what keeps the service
working. Raise `Database__MaxPoolSize` when PostgreSQL has more connection slots (see below).

## Sizing rule

`instances × Database__MaxPoolSize + 10 (migrations, backups, admin) ≤ PostgreSQL max_connections`.
With the defaults: up to 3 instances on a database with `max_connections = 100`.

## Two instances (Phase 3: "validate a two-replica environment")

`scripts/load/two-instances.mjs`, run against two Release instances sharing one database, passed:

- a cookie issued by one instance is accepted by the other;
- an antiforgery token from either instance is accepted by the other;
- simultaneous edits of one task on two instances: one wins, the other gets 409;
- two instances starting different timers at the same moment: exactly one runs;
- a password change on one instance signs the old session out on the other;
- after stopping and restarting an instance, an existing session still works (keys live in the
  database). This also demonstrates the Phase 1 exit criterion "sessions persist across
  deployments" — locally, not on a deployed environment.

Not yet checked: graceful draining of in-flight requests during a rolling deploy behind a real
load balancer.

## Proposed objectives (to agree)

| Objective | Proposal | Status on this machine |
|---|---|---|
| Today and Planner open, p95 | under 300 ms at expected load | 57 ms at 50 simulated users; 517 ms at 200 |
| Writes (tick, capture), p95 | under 300 ms at expected load | 83 ms at 50 simulated users |
| Error rate | under 0.1 % | 0 % at 50 and 200 |

"Expected load" needs a number from you: how many people do you expect to be using it at the busiest
moment in the first year?
