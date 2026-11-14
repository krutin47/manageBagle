# ADR-008: Civil time, an account time zone, and elapsed durations

- **Status:** Accepted — implemented for one-off blocks
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

People plan in wall-clock time. Wall-clock time only becomes an instant with a time zone, and twice a year the mapping is irregular. The first version used the browser's clock and had no zone.

## Decision

Each account has an IANA time zone, taken from the device at sign-up and changeable in Settings. A block stores its civil date and times plus the zone it was planned in, and stays anchored there if the person travels. **Spring forward:** a start or end inside the missing hour is rejected, with the next real time offered. **Fall back:** an ambiguous time means its first occurrence. A block's length is the elapsed minutes between its two instants. "Today" and "now" in the client follow the account's zone; when the device is in a different zone the app asks whether to switch, and never switches silently.

## Alternatives rejected

Browser-local time only; storing everything as UTC instants (loses the intent of "09:00 every Monday").

## Consequences

Rows from before zones have no zone and keep their wall-clock length; nothing was shifted. Recurring blocks, when built, must repeat in civil time.

## Implementation state

Implemented: `Domain/CivilTime.cs` with tests for overnight, month/year end, both DST transitions and travel. Not yet: actual start/finish instants (only minutes are logged); recurrence.
