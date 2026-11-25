# Runbook: backup and restore

The database holds everything needed to recover the service, including accounts, MFA keys and the
key ring that encrypts session cookies. A restore without the key ring signs everyone out and
invalidates emailed links, but loses no data.

## Back up

```bash
DATABASE_URL=postgres://user:pass@host:5432/managebagle ./scripts/backup.sh ./backups
```

In production, the managed PostgreSQL service's automated backups and point-in-time recovery are the
primary mechanism. Use this script for portable copies and for drills. Store dumps encrypted; they
contain personal data and credentials material.

## Restore drill

```bash
ADMIN_URL=postgres://user:pass@drill-host:5432/postgres ./scripts/restore-drill.sh ./backups/<file>.dump [source-url]
```

Restores into a scratch database, compares row counts with the source, checks the migration history
and key ring are present, reports how long it took, and drops the scratch database.
**Never point `ADMIN_URL` at production.**

## Drill log

| Date | Environment | Result | Restore time | By |
|---|---|---|---|---|
| 2026-11-14 | local development database | Passed: all table counts matched, key ring present | 1 s (≈80 KB dump) | automated during build-out |

No production drill has been performed: there is no production environment yet. The handbook's
initial targets (RPO ≤ 24 h, RTO ≤ 4 h) are unmeasured until one is.

## Real restore

1. Stop the app or put it in maintenance.
2. Create a new database and `pg_restore --no-owner --no-privileges --dbname <new-url> <dump>`.
3. Point `ConnectionStrings__Default` at it and start the app; check `/health/ready`.
4. Tell users they may need to sign in again if the dump predates a key rotation.
