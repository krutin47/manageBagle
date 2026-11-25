# Runbook: release and rollback

## Release

1. CI is green on the commit and the image digest is recorded.
2. **Back up** the target database (managed snapshot, or `scripts/backup.sh`).
3. **Migrate**, as a one-off job using the new image:
   `docker run --rm -e ConnectionStrings__Default=… <image@digest> --migrate`
   It logs which migrations it applied and exits 0.
4. **Deploy** the new image. The platform should route traffic only when `/health/ready` is 200; it
   stays 503 while the schema is behind the build.
5. **Smoke test**: sign in, open Today, save a one-task brain dump, reload.

## Rollback

- Redeploy the **previous image digest**. Schema changes are expand/contract, so the previous version
  runs against the newer schema.
- Do **not** run a database downgrade. If a migration itself is the problem, restore the backup from
  step 2 into a new database and point the previous image at it.

## Probes

| Path | Meaning | Use for |
|---|---|---|
| `/health/live` | process is up (ignores the database) | liveness / restart |
| `/health/ready` | database reachable and schema current | readiness / routing |
| `/healthz` | same as ready | older probes |
