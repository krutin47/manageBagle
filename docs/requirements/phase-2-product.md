# Phase 2 product requirements

Status: **built** (A–D2) on `feature/handbook-phase-1`; D3 is Phase 3 · Source: product owner, 2026-11-25 · Tracks into
[handbook-status.md](../handbook-status.md) (Phase 2 — product)

These are the product owner's requests, restated as requirements with acceptance criteria so each
can be built and tested on its own. IDs (P2-…) are used in commits, tests and the status tracker.

Phase 2 of the handbook is "architecture and maintainability". These features are built inside that
phase, as vertical slices, on the new boundaries — each one is a chance to move logic out of
endpoints rather than add to them.

---

## A. Brain dump: faster capture, clearer choices

The brain dump is the front door of the app. Capturing a task should take one line and a couple of
taps; every option should look and behave the same way.

### P2-A1 Priority comes from the due date
The capture row no longer asks for a priority. Urgency is derived from the due date:

| Due | Priority |
|---|---|
| overdue, today or tomorrow | High |
| within the next 7 days | Medium |
| later, or no due date | Low |

Outcome **impact** stays a separate, explicit choice: impact is *value*, the due date is *urgency*.
Priority can still be set by hand in the full task editor in the backlog.

*Accepted when:* the brain dump shows no priority control; a task saved with a due date of tomorrow
is stored as High; top-three suggestions still weight impact over urgency.

### P2-A2 Deep focus defaults to two hours
Choosing **Deep focus** as the kind of work sets the length to **2 h**, unless the person has already
chosen a length for that task themselves. A manual choice is never overwritten.

*Accepted when:* new task → Deep focus → 2 h; new task → set 45 m → Deep focus → stays 45 m.

### P2-A3 Focus area as a tag
The focus area ("No focus area", "Home / Admin" …) is shown as a **coloured tag bubble** that opens a
short list of areas when clicked, instead of a dropdown box.

### P2-A4 Sorting that visibly works
Today the sort buttons reorder once and give no feedback; when tasks are equal on the chosen key
nothing appears to happen. Replace them with a **sort mode** that stays on and shows which one is
active: *As written · Topic · Impact · Due date*.
- **Topic** groups tasks under a heading per focus area, then by kind of work.
- **Impact** orders by impact, then by due date.
- **Due date** orders soonest first; tasks without a date go last.
- New tasks are placed according to the active mode.

*Accepted when:* each mode produces the documented order on a mixed list, and the active mode is
announced to screen readers.

### P2-A5 Backlog suggestions look different from tags
Suggestions from the backlog become **rounded-rectangle chips with a soft light border**, clearly
distinct from the pill-shaped focus-area tags.

### P2-A6 One consistent row of options
Every option on a task — length, kind of work, focus area, impact, due date, outside work — uses the
same compact chip control, in one row, in the same order on every task. Due date offers quick picks
(Today, Tomorrow, This Friday, Next Monday) plus a date picker and Clear.

### P2-A7 Outside work as an icon
"Outside work" becomes an **icon-only toggle** with a tooltip that explains it: *"Outside work —
errands, travel, appointments. Adds a buffer because the physical world runs late."* The tooltip
appears on hover **and** keyboard focus; the control still has an accessible name.

---

## B. Focus timer on Today

People should be able to press play, do the work, and have the real time recorded for them.

### P2-B1 Play, pause, stop
Every block on Today has a **play** button. While running it shows elapsed time and offers **pause**
and **stop**. A small "now playing" bar stays visible on every page while a timer runs.

### P2-B2 One timer at a time
Only one block can be running per account, on any device. Starting a second asks to pause the first
("Pause *X* and start *Y*?"). The rule is enforced by the server, not only the screen.

### P2-B3 Time is recorded
Tracked time is saved to the block's **actual minutes** whenever the timer pauses or stops. It
survives a reload, a closed tab and a second device.

### P2-B4 Time's up
When the tracked time reaches the planned length, the app asks **"Need more time?"** — *+15 min*,
*+30 min*, or *I'm done*. Extra time is recorded as an extension; the original plan is kept so
plan-versus-reality stays honest. If the tab is in the background, a browser notification is shown
when permission has been given.

### P2-B5 Stopping asks why
Stop opens one question with three answers:
1. **I finished it** — block done, actual time saved.
2. **Not finished — another time** — block closed with the time worked so far; the task returns to the
   backlog unscheduled so it shows up in *Due soon* and brain-dump suggestions.
3. **Drop it** — block and task are dropped, with an **optional note** saying why. The note appears in
   the Review page.

*Accepted when:* each answer leaves the block, the task and the top-three outcome in the documented
state, and a second tab sees the same timer state after reload.

---

## C. Daily routines, breaks and reminders

Some time is already spoken for every day — lunch, dinner, a workout, the working day. Planning should
start from that, not fight it.

### P2-C1 Routines
A person can set up **routines**: a title, the weekdays they repeat on, a start and an end (e.g.
*Lunch, Mon–Fri, 12:30–13:15*). Routines appear on Today and in the Planner as background bands,
not as tasks to tick.

### P2-C2 Can tasks go here?
Each routine says whether tasks may be placed inside it:
- **No tasks** (lunch, gym) — the time is protected;
- **Any task**;
- **Only these focus areas** (e.g. a *Work hours* routine that accepts *Career* and *Build* tasks).

### P2-C3 Tasks land where they belong
When the brain dump fits tasks into the day, a task whose focus area is accepted by a routine is
placed inside that routine first; tasks never land in a *No tasks* routine, nor in a routine that
does not accept their area. The plan also stays within the person's **day window** (e.g. 08:00–21:00)
instead of running towards midnight.

### P2-C4 Recovery breaks
A person can ask for a short **recovery break** before or after work of a given kind: per focus area
(e.g. 10 min after every *Build* task) and, when needed, per task. When fitting the day, the break is
reserved next to the task and shown as a light "recovery" segment. Breaks are not counted as planned
work. The aim is meaningful rest without extra planning effort: set once, applied automatically.

### P2-C5 Reminders
- **Drink water**: an optional reminder every 30/45/60/90 minutes within the day window.
- **Meals**: a reminder at the start of any routine marked as a meal.

Reminders are in-app toasts, plus browser notifications when permission has been given and the app is
open in a tab. *Not in this phase:* notifications while the app is fully closed (needs Web Push and a
service worker; recorded for Phase 3).

*Accepted when:* routines repeat correctly across a daylight-saving change, the fitting rules above
hold in tests, and reminders fire at the documented times.

---

## D. Calendars

### P2-D1 Subscribe from any calendar app
The Planner can be **exported**: a private subscription link (iCalendar format) that Google Calendar,
Apple Calendar and Outlook can subscribe to, plus a one-off `.ics` download. The link can be
regenerated, which stops the old one working. It contains only block titles and times.

*Honest limit:* calendar apps refresh subscriptions on their own schedule — Google Calendar can take
several hours — so this is for seeing the plan elsewhere, not for second-by-second sync.

### P2-D2 Plan around existing meetings
A person can connect an existing calendar by its **private iCal address** (Google Calendar: *Settings →
Integrate calendar → Secret address in iCal format*; Outlook and Apple offer the same). Its events are
read, shown in the Planner and on Today as **busy**, and the brain dump fits tasks around them.

### P2-D3 Write into Google Calendar, two-way sync — *later*
Writing blocks directly into Google Calendar, and keeping both sides in step, needs Google's Calendar
API with OAuth consent per user. Recorded for **Phase 3** (see ADR-015).

---

## Order of work

1. Brain dump (A) — smallest, highest daily impact.
2. Focus timer (B).
3. Routines, day window, breaks, reminders (C) — extends the PlanDay use case.
4. Calendars (D1 then D2).

Each slice ships with API tests, client tests and at least one end-to-end test, per `AGENTS.md`.
