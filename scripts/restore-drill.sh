#!/usr/bin/env bash
# Restore drill: proves a backup can be turned back into a working database.
#
#   ADMIN_URL=postgres://user:pass@host:5432/postgres ./scripts/restore-drill.sh path/to/file.dump [source-url]
#
# Restores the dump into a scratch database, checks it, and drops the scratch database again.
# With a source URL, row counts are compared against the live database the dump came from.
# Never point ADMIN_URL at production: use a separate server or a UAT instance.
set -euo pipefail

DUMP="${1:?usage: restore-drill.sh <dump-file> [source-database-url]}"
SOURCE_URL="${2:-}"
: "${ADMIN_URL:?Set ADMIN_URL to a maintenance database on the server to restore into}"

SCRATCH="mb_restore_drill_$(date +%s)"
SCRATCH_URL="${ADMIN_URL%/*}/$SCRATCH"
TABLES='"AspNetUsers" "FocusAreas" "BacklogTasks" "TimeBlocks" "DailyOutcomes" "DailyReviews" "DataProtectionKeys" "__EFMigrationsHistory"'
count() { psql --no-psqlrc --tuples-only --no-align --command "SELECT count(*) FROM $2" "$1"; }

START=$(date +%s)
psql --no-psqlrc --quiet --command "CREATE DATABASE \"$SCRATCH\"" "$ADMIN_URL"
trap 'psql --no-psqlrc --quiet --command "DROP DATABASE IF EXISTS \"$SCRATCH\"" "$ADMIN_URL"' EXIT

pg_restore --no-owner --no-privileges --exit-on-error --dbname "$SCRATCH_URL" "$DUMP"
ELAPSED=$(( $(date +%s) - START ))

FAILED=0
for TABLE in $TABLES; do
  RESTORED=$(count "$SCRATCH_URL" "$TABLE")
  if [ -n "$SOURCE_URL" ]; then
    LIVE=$(count "$SOURCE_URL" "$TABLE")
    STATUS=$([ "$RESTORED" = "$LIVE" ] && echo ok || { FAILED=1; echo MISMATCH; })
    printf '%-26s restored=%-8s source=%-8s %s\n' "$TABLE" "$RESTORED" "$LIVE" "$STATUS"
  else
    printf '%-26s restored=%s\n' "$TABLE" "$RESTORED"
  fi
done

# Without the key ring nobody could sign in after a restore.
if [ "$(count "$SCRATCH_URL" '"__EFMigrationsHistory"')" -eq 0 ]; then echo "No migration history restored"; FAILED=1; fi

echo "Restore took ${ELAPSED}s"
[ "$FAILED" -eq 0 ] && echo "DRILL PASSED" || { echo "DRILL FAILED"; exit 1; }
