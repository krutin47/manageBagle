# ADR-005: Problem Details and a single exception boundary

- **Status:** Accepted — implemented
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

Errors must look the same everywhere so the client can branch on them and support can trace them.

## Decision

Every error is `application/problem+json` (RFC 9457) with a stable `code` and a `traceId`. Expected outcomes (validation, not found, stale version) are returned by endpoints. Unexpected exceptions bubble to one `IExceptionHandler`, are logged once, and become a safe 500. Validation uses **400** throughout. The client maps responses to `NetworkError`, `UnauthorizedError`, `ValidationError`, `ConflictError`, `RateLimitError`, `UnexpectedApiError`.

## Alternatives rejected

try/catch in every layer; HTTP 200 with `{success:false}`; 422 for some validation and 400 for other.

## Consequences

Changing a `code` is a breaking API change. Codes are listed in `Infrastructure/Errors.cs`.

## Implementation state

Implemented, with tests asserting the shape for 400, 401, 404, 409.
