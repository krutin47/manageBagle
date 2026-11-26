# ADR-017: Azure Container Apps, deployed by GitHub Actions with OpenID Connect

- **Status:** Accepted — template and workflows written; not yet deployed (needs the owner's Azure account)
- **Date:** 2026-11-25
- **Source:** product owner's choice of Azure; handbook Phases 1 and 3

## Decision

- **Compute:** Azure Container Apps (consumption). One immutable image (ADR-009) per environment as
  a single-revision app: a new revision takes traffic only when `/health/ready` passes, which it
  does only once migrations are applied, so deploys have no downtime and a failed migration leaves
  the old version serving. UAT scales to zero; production keeps one replica, up to two.
- **Migrations:** a Container Apps job runs the same image with `--migrate` after the template is
  applied; the workflow waits for it.
- **Database:** one Azure Database for PostgreSQL Flexible Server (Burstable B1ms, PostgreSQL 16,
  35-day backups) with a database per environment. Shared to stay within the free tier and about
  US$15 a month later. Both environments connect as the server administrator.
- **Images:** GitHub Container Registry. Built only on `uat`; production redeploys the digest UAT
  ran (matched by git tree), after `gh attestation verify` checks the Sigstore-signed build
  provenance. An SBOM is attached by BuildKit.
- **Access:** GitHub Actions signs in with OpenID Connect federated credentials restricted to the
  repository's `uat` and `production` environments; the identity is Contributor on one resource
  group only. No long-lived Azure credential exists.
- **Configuration:** non-secret settings are GitHub environment variables; secrets are GitHub
  environment secrets, passed as secure template parameters and stored as Container Apps secrets.
- **Trusted proxy:** the Container Apps ingress is the only way in, so its forwarded headers are
  trusted (`ForwardedHeaders__KnownNetworks=0.0.0.0/0,::/0`, one hop). The smoke test proves it: a
  write is accepted only if the app sees HTTPS.

## Alternatives rejected

App Service (no scale-to-zero, similar cost); AKS (far more to operate — ADR-010); Azure Container
Registry (US$5/month for what GHCR does free); a database server per environment (doubles the
largest cost for a personal app).

## Consequences and risks

- UAT and production share a database server and its administrator login: a compromised UAT
  instance could read production data. Upgrade path when that matters: a second server, or
  per-environment database roles created by the migration job.
- Container Apps ingress addresses are not published, hence trusting any proxy. Safe only while
  the container has no other route in (true without virtual-network injection).
- `az bicep build` runs in CI; nothing has been deployed yet, so the template's behaviour on Azure is
  unverified until the first UAT release.
