# ADR-002: Minimal APIs with built-in OpenAPI

- **Status:** Accepted — implemented
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

The client and server must agree on the contract, and changes to it must be visible in review.

## Decision

Keep minimal APIs. Generate the OpenAPI document with the framework (`AddOpenApi`/`MapOpenApi`), served at `/api/openapi.json` outside Production only. The document is committed at `docs/api/openapi.json`; a test fails when the live contract differs from the snapshot.

## Alternatives rejected

Rewriting endpoints as MVC controllers; hand-written API docs.

## Consequences

Any route, field or status change appears as a diff in the pull request. Regenerate with `MB_UPDATE_OPENAPI=1 dotnet test --filter Api_contract`.

## Implementation state

Implemented. Not yet: generated TypeScript types from the document; URL versioning (`/api/v1`) is deferred until the first breaking change.
