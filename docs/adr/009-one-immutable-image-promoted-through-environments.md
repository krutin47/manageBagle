# ADR-009: One immutable image promoted through environments

- **Status:** Accepted — not yet implemented
- **Date:** 2026-11-14
- **Source:** Production Architecture Handbook, decision register

## Context

Rebuilding per environment means UAT and production can run different code.

## Decision

CI builds one OCI image per reviewed commit. The same digest is deployed to UAT and then production with environment-specific configuration. Migrations run as a release step (`--migrate`) before the new version takes traffic; `/health/ready` is unhealthy until the schema matches.

## Alternatives rejected

Building separately on `uat` and `main`.

## Consequences

Schema changes must be expand/contract so the previous image still runs after a migration.

## Implementation state

Implemented: `--migrate`, readiness tied to schema, CI job that boots the image and walks that sequence. Not yet: a registry, deploy pipeline, or any hosted environment.
