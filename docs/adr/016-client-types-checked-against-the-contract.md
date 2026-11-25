# ADR-016: Client types are checked against the API contract at compile time

- **Status:** Accepted — implemented
- **Date:** 2026-11-25
- **Source:** Handbook Phase 2, "Generated TypeScript contracts"

## Context

The server publishes its contract as `docs/api/openapi.json`, and a server test fails when the
contract changes without the snapshot being updated (ADR-002). The client's types in
`client/src/lib/api.ts` were written by hand, so nothing stopped them from drifting from the
server — and one had: `Outcome.backlogTaskId` was optional on the client but always sent by the server.

The hand-written types are deliberately *narrower* than the contract (a colour is one of eight names,
not any string), so replacing them wholesale with generated types would lose information.

## Decision

1. `client/scripts/api-types.mjs` generates `client/src/lib/api.generated.ts` from the contract
   (`npm run gen:api`). It has **no dependencies**: it handles exactly the schema shapes the API emits
   (objects, arrays, enums, nullable unions, `$ref`, `oneOf`, dictionaries). Installing a generator
   package (e.g. `openapi-typescript`) was considered and rejected to avoid a new build dependency.
2. A unit test regenerates the file in memory and fails if the committed copy is stale.
3. `client/src/lib/contract.check.ts` proves at compile time that each hand-written response type has
   the same fields, nullability and optionality as its generated counterpart (string literals are
   widened before comparing), and that each request type sends only fields the server knows.
   `npm run typecheck` fails on drift.
4. Every API endpoint declares its success response (`Produces…`), enforced by
   `EndpointMetadataTests`, so the contract describes every operation; anonymous response objects in
   the auth endpoints became named records with identical JSON.

## Workflow after an API change

```bash
MB_UPDATE_OPENAPI=1 dotnet test server/ManageBagle.slnx --filter ContractTests
```

```bash
cd client && npm run gen:api && npm run typecheck
```

## Consequences

- Drift between server and client is a build failure, not a runtime surprise.
- The generator must be extended if the API starts using schema features it does not handle; the
  staleness test and a type error make that visible.
- Request types are checked one way only (client fields ⊆ server fields), because the server fills
  in defaults for fields a client may omit.
