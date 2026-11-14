# ADR-006: Cookie sessions with real antiforgery tokens

- **Status:** Accepted — implemented
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

The API is authenticated by cookie, so a hostile page can make a browser send requests. The original defence was a static custom header: it is not a secret.

## Decision

Three independent checks on every state-changing `/api` request: the custom header (kept as defence in depth); the `Origin` header, when present, must be this site; an ASP.NET Core antiforgery token bound to the browser's cookie and the signed-in account. The client fetches the token from `GET /api/auth/csrf`, keeps it in memory, and refetches after the account changes.

## Alternatives rejected

Static header alone; disabling CSRF protection because the API is JSON.

## Consequences

Sign-in, sign-out and all settings changes are covered. OAuth callbacks are GET requests protected by the provider's own `state`.

## Implementation state

Implemented, with tests for a forged request, a token from another account, a foreign origin, and plain HTTP.
