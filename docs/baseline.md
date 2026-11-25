# Phase 0 baseline

What was checked before changing anything, at commit `ea538da` (tip of `claude/bold-hawking-q13xxd`),
on 2026-11-14. The handbook was written from documents; this records what the code actually did.

| Area | Handbook's concern | Finding | Classification |
|---|---|---|---|
| CSRF | Static `X-MB-Client` header is not a secret | Confirmed: `UseClientHeaderCheck` only tested the header's presence | Verified defect → fixed (ADR-006) |
| Account linking | Verified matching email auto-links and may remove credentials | Confirmed in `AuthEndpoints` external callback | Verified defect → fixed (ADR-007) |
| Email confirmation | None at registration | Confirmed: register signed the user straight in | Verified gap → fixed |
| Forwarded headers | Trusting any sender | Confirmed: `KnownProxies.Clear()` and `KnownIPNetworks.Clear()` | Verified defect → fixed |
| Time zone | Browser-local only | Confirmed: no zone stored anywhere | Verified gap → fixed (ADR-008) |
| Lost updates | No versioning | Confirmed: last write won | Verified gap → fixed (ADR-011) |
| "One tick finishes task, block, outcome" | Unsafe for multi-session tasks | Confirmed: unconditional cascade | Verified defect → fixed |
| Migrations on startup in production | Should be a release step | Confirmed: default was `true` everywhere | Verified → fixed |
| Ownership checks | Must cover referenced entities on write | Already correct: area and task ids are checked for ownership; covered by tests | Verified sound |
| Cookies | HttpOnly, Secure, SameSite | Already correct | Verified sound |
| Data Protection keys | Persisted for multi-instance | Already in the database | Verified sound; not yet exercised across a real redeploy |
| Password reset | Non-disclosing, one-time | Non-disclosing confirmed; one-time now covered by a test | Verified sound |
| Log redaction | No sensitive content | Email bodies were logged in Development only; request logging added with route templates | Verified sound |
| Docker image | Never built | Still never built | **Unknown** |
| CI workflow | Never run | Still never run | **Unknown** |
| Performance (p95, SQL counts) | Not measured | Not measured | **Unknown** |
| Backups | None | Scripts written; drill passed locally | Documented only for production |
| Credential leakage in the repository | Must be none | No secrets in source or history; `.env` files are ignored | Verified sound |

## Commands run

```
client:  npm ci · npm run lint · npm run typecheck · npm test · npm run build
server:  dotnet build -c Release -warnaserror · dotnet test
e2e:     npx playwright test
release: publish → run in Production → /health/ready 503 → --migrate → /health/ready 200
backup:  scripts/backup.sh → scripts/restore-drill.sh (row counts match, key ring present)
```
