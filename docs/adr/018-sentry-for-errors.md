# ADR-018: Errors are reported to Sentry

- **Status:** Accepted — implemented; reports only when `Sentry__Dsn` is set
- **Date:** 2026-11-25
- **Source:** product owner's choice (free plan); handbook Phase 1 item 3, "central error monitoring"

## Decision

- The server uses the official `Sentry.AspNetCore` SDK. It is configured only when `Sentry__Dsn` is
  set; otherwise nothing is sent and nothing changes.
- **What is sent:** unhandled server exceptions (with stack traces), and browser errors, which the
  client already reports to `/api/client-errors` and the server forwards as messages with the
  reference shown to the person. Environment (`UAT`/`Production`) and release are attached.
- **What is not sent:** no request bodies, cookies, headers, query strings or IP addresses
  (`SendDefaultPii = false`, plus a filter that drops request data), no user email. The user id is
  sent so one person's repeated errors group together; it is an opaque GUID.
- **Volume:** the free plan allows 5,000 errors a month. Expected 4xx results (validation, conflicts,
  sign-in failures) are not exceptions and are never sent. Traces are not sent (sample rate 0): the
  free plan's performance quota is small and OpenTelemetry already covers traces.
- The browser does not load a Sentry script: keeps the first download small, keeps the Content
  Security Policy strict, and keeps one place where data is filtered.

## Alternatives rejected

Azure Monitor / Application Insights (works, but the owner chose Sentry); OpenTelemetry export to
Sentry (traces only, no issue grouping); the browser SDK (a second, unfiltered path out).
