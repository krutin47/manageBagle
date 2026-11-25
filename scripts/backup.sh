#!/usr/bin/env bash
# Takes a compressed, restorable dump of the manageBagle database.
#
#   DATABASE_URL=postgres://user:pass@host:5432/managebagle ./scripts/backup.sh [output-dir]
#
# The dump contains everything needed to sign in again after a restore: accounts, MFA keys and the
# cookie-encryption key ring live in the same database. Treat the file as sensitive and store it
# encrypted. A managed PostgreSQL service's own backups/PITR remain the primary mechanism in
# production; this script is for portable copies and for the restore drill.
set -euo pipefail

: "${DATABASE_URL:?Set DATABASE_URL to the database to back up}"
OUT_DIR="${1:-./backups}"
mkdir -p "$OUT_DIR"
FILE="$OUT_DIR/managebagle-$(date -u +%Y%m%dT%H%M%SZ).dump"

pg_dump --format=custom --no-owner --no-privileges --file "$FILE" "$DATABASE_URL"
echo "$FILE"
