# Plan: Brain dump, top three, and a clearer Today

Status: **built on `claude/bold-hawking-q13xxd`** (sections 1–5); the "not in this change" list is open · Owner: product · Last updated: 2026-11-14

## Why

Today asked people to understand three separate things at once (outcomes, blocks, backlog) and the
end-of-day review sat on the same page. Adding a task meant choosing which of those it was first.
The paper planner this is modelled on does it in one motion: dump everything, pick three, give them
time.

## What we are building

### 1. Brain dump (one flow, three steps)

Opened from Today with **Brain dump**. It replaces "Plan my day".

| Step | What the person does | What the app does |
|---|---|---|
| 1. Brain dump | Types tasks, one per line, Enter to add. Each line has duration, priority, outcome impact and due date in view; kind of work, focus area and "outside work" one click away. | Suggests open backlog tasks, **due and overdue first**. Offers a sorter. |
| 2. Top three | Taps the three with the highest value. | **Suggest for me** ranks by impact, then priority, then how soon it is due. |
| 3. Fit into the day | Answers "Shall I add all of these to today?" | Proposes times around what is already booked. Whatever does not fit stays in the backlog. |

Decisions:

- **Outcome impact** is a new field on a task (High / Medium / Low), separate from priority.
  Priority is urgency; impact is how much it moves things. Top-three suggestions weight impact most.
- **Outside work** (errands, travel, appointments) gets a buffer of 25 %, at least 10 minutes,
  because the physical world overruns.
- **Topic sorter.** "By topic" groups lines by focus area, then kind of work. The same grouping is
  used when fitting the day (**Batch similar work**, on by default), so related tasks sit next to
  each other and context switches drop. Order when fitting: top three → then topic by topic.
- One save. Tasks, booked blocks and the top three are written in a single request; it all lands or
  none of it does.
- One tick. A top-three outcome, its block and its backlog task are linked. Finishing any one
  finishes the others.

### 2. Today

Single column, in the order the day runs:

1. **Top three** – the three picked in the brain dump, each showing its booked time.
2. **Schedule** – the day's blocks; top-three blocks carry their number.
3. **Due soon** – open tasks that are overdue or due within 7 days and not yet booked, each with
   **Add to today**. Replaces the review.

An empty day shows one invitation to brain dump instead of three empty sections.

### 3. Review moves out

End-of-day review becomes its own page (**Review** in the navigation) with the day's numbers next to
the three questions. It is optional; Today no longer mentions it.

### 4. Moving tasks

- **Backlog board** – kanban columns (To do, In progress, Done, Dropped); drag a card to change
  status. List view stays.
- **Calendar** – drag a block to another time or day (mouse and pen). On touch and keyboard, the
  edit dialog changes date and time.

### 5. Sign-in

- Microsoft sign-in added next to Google. Both buttons appear only when the server has that
  provider's credentials, which is why none show on a fresh install.
- Providers are now a list in one place (`ExternalProviders`), so an OpenID Connect SSO provider is
  one more entry plus its handler registration.

## Data changes

| Table | Change |
|---|---|
| `BacklogTasks` | `+ WorkMode`, `+ IsOutside`, `+ Impact` |
| `TimeBlocks` | `+ IsOutside` |
| `DailyOutcomes` | `+ BacklogTaskId` (nullable link to the task) |

New endpoint: `POST /api/days/{date}/plan`.

## Not in this change (recorded so they are not lost)

| Idea | Note |
|---|---|
| **AI rewrite of a line into a goal** | Needs a text model. Cheapest route is a small hosted model called from the API with a per-user daily cap; a local model is possible but adds hosting. The brain-dump line already has the place for a "rewrite" action. |
| **Smarter topic sorting** | Today "topic" means the focus area the person chose. Grouping by meaning of the text (and suggesting the focus area automatically) needs the same model as above. |
| **Single sign-on (SSO)** | OpenID Connect per organisation. Provider list is ready; needs tenant configuration and an admin screen. |
| **Linking Google/Microsoft to an existing account from Settings** | Safe only while signed in; not built yet. |
| **Touch drag on the calendar** | Needs a long-press gesture so it does not fight scrolling. |

## How we will know it works

- API tests: plan is atomic, cannot touch another user's tasks, block ↔ outcome ↔ task stay in sync.
- Client tests: day-fitting (order, gaps, buffer, batching, overflow), contrast of every new colour pairing.
- Browser run: brain dump end to end, kanban drag, calendar drag persisted after reload, phone width.
