# Data inventory and retention (handbook §17.3)

Status: inventory complete; retention periods **agreed by the product owner on 2026-11-25** ·
Updated 2026-11-25

## What is stored, why, and for how long

| Data | Where | Why | Kept | Personal? |
|---|---|---|---|---|
| Email, display name, time zone, password hash, security stamp | `AspNetUsers` | sign-in, emails, planning in the right zone | until the account is deleted | yes |
| Authenticator key, unused recovery codes | `AspNetUserTokens` (stored by ASP.NET Core Identity as issued, not hashed — protected by database access and encryption at rest) | two-step verification | until turned off or the account is deleted | yes (secret) |
| Linked Google / Microsoft account ids | `AspNetUserLogins` | sign-in with those providers | until unlinked or the account is deleted | yes |
| Tasks, blocks, top threes, reviews, day themes, focus areas, routines, preferences | app tables | the product itself | until the person deletes them or the account | yes |
| Finished and dropped tasks | `BacklogTasks` | history | kept; the default view shows the last 30 days | yes |
| Account activity (sign-ins, security changes, exports) | `AuditEvents` | lets the owner spot misuse; supports recovery | 13 months (`Retention__AuditMonths=13`, set in the Azure template) | yes |
| Private calendar addresses (encrypted) | `CalendarConnections` | read busy time | until disconnected or the account is deleted | yes (secret) |
| Copies of other calendars' events (title, start, end) | `ExternalEvents` | plan around meetings | replaced on every refresh (≤ 15 min old when in use); deleted with the connection | yes |
| Calendar subscription link (encrypted and hashed) | `AspNetUsers` | export to other calendar apps | until regenerated or the account is deleted | secret |
| Notification subscriptions (push service address and the browser's public keys) | `PushSubscriptions` | reminders while the app is closed | until turned off, signed out on that browser, rejected by the push service, or the account is deleted | device identifier |
| Sent-reminder records | `PushDeliveries` | send each reminder once | 2 days | no content |
| Notification keys (VAPID; private half encrypted) | `PushKeys` | sign notifications | until replaced | no |
| AI usage records (model, token counts, cost; no text) | `AiUsage` | monthly budget and daily limit | 13 months, with account activity (`Retention__AuditMonths`) | account id only |
| Idempotency records for "plan my day" | `IdempotencyRecords` | a repeated click saves once | 24 hours, then purged | no content beyond the plan |
| Cookie-encryption keys | `DataProtectionKeys` | keep people signed in across restarts | managed by ASP.NET Core (90-day key lifetime) | no |
| Application logs | wherever the host collects stdout | diagnosing faults | 30 days (Log Analytics retention, set in the Azure template) | route templates, user ids, trace ids and browser error messages — no request bodies, emails or task text |
| Database backups | backup storage | recovery | 35 days (Azure PostgreSQL automated backups, set in the Azure template) | yes, everything above |
| Browser storage | the person's browser | unsaved brain dump (session only), theme, "already asked" flags | until the tab or browser clears it | the draft text |

No analytics, advertising or third-party tracking.

**AI brain dump (ADR-020):** only when the person presses "Turn into tasks", that text, today's date
and the names of their focus areas are sent to Anthropic's Claude; the reply is shown as suggestions
and the text is not stored by the app. Anthropic's handling: see its commercial terms (API inputs are
not used for training). **Dictation** uses the browser's speech recognition: in Chrome and Edge the
audio goes to the browser maker's speech service, in Safari to Apple's; manageBagle never receives
audio.

## The person's rights, in the product

| Right | How |
|---|---|
| See and take their data | Settings → Your data → **Download my data** (`GET /api/account/export`): one JSON file. Secrets are left out. The export is recorded in Account activity. |
| Correct it | everything is editable in the app |
| Delete it | Settings → Delete account: removes the account and every row above at once (database cascades). Backups age out within the backup retention period. |

## Still open

- A privacy notice for the sign-up page, once a company name and contact address exist.
