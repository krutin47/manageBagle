# ADR-015: Calendar interoperability starts with iCalendar feeds

- **Status:** Accepted — in build (export and read-only import); write-back deferred to Phase 3
- **Date:** 2026-11-25
- **Source:** Phase 2 product requirements, P2-D

## Context

People want to see their plan in Google, Apple or Outlook calendars, and want the plan to avoid
meetings already in those calendars. Later they want two-way sync.

## Decision

1. **Export** as an iCalendar (RFC 5545) subscription feed at an unguessable, per-account URL that the
   owner can regenerate. It carries block titles and times only — no notes. Every calendar app can
   subscribe without manageBagle holding any of their credentials.
2. **Import busy time** by reading the person's *private iCal address* of their existing calendar.
   The server fetches it with strict limits: HTTPS only, no private or loopback addresses after DNS
   resolution, no redirects, 10-second timeout, 2 MB cap, and per-account rate limits. Events are
   cached and refreshed at most every 15 minutes. Only start, end and title are kept.
3. **Write-back and two-way sync** use the Google Calendar API with per-user OAuth consent and are
   deferred to Phase 3, together with Microsoft Graph for Outlook.

## Alternatives rejected

Starting with the Google Calendar API (OAuth verification, token storage and refresh, Google-only);
CalDAV (poor support in Google).

## Consequences

Subscribed feeds refresh on the calendar app's schedule (Google: up to several hours). The private
iCal address is a secret: it is stored encrypted with the app's data-protection keys and never logged.
Fetching user-supplied URLs is a server-side request forgery risk; the limits above are tested.
