# Working agreement for engineers and AI agents

From the Production Architecture Handbook, §22. It applies to every change in this repository.

**The first rule: never say code was verified or tests passed unless you actually ran them.** Report
what was run and its result. "Not run" and "could not run" are acceptable answers; a guess is not.

1. Read `docs/project-overview.md`, the relevant feature, and `docs/adr/` before editing.
2. Before a large change, state the use case, the invariants it touches, the security boundary, the
   migration impact and the tests.
3. One vertical slice at a time. Preserve existing behaviour unless the task changes it on purpose.
4. No speculative patterns: no generic repositories, unused interfaces, or new dependencies without
   an ADR.
5. Never bypass ownership checks, antiforgery validation, input validation or log redaction.
6. Add or update tests with the behaviour: domain tests, API integration tests, client tests, and an
   end-to-end test when a user-visible flow changes.
7. Keep TypeScript strict, C# nullable, UI accessible, errors as Problem Details, and
   `CancellationToken` passed through.
8. Database changes: include the migration, say whether the previous app version can still run
   against it, why each index or constraint exists, and what happens to existing rows.
9. API changes: update `docs/api/openapi.json` (the contract test tells you how), client types, error
   states and docs.
10. Performance changes come with before/after measurements. No blanket `useMemo`.
11. Auth and security changes need human review and adversarial tests. Never silently alter linked
    identities or MFA credentials.
12. End with a short summary: what changed, how it behaves, which tests were actually run, what risk
    remains, and what someone has to configure by hand.

## Invariants that must not regress

- A user can reach only their own data, including through ids they send.
- Same-origin cookie sessions; no session token in `localStorage`.
- A day plan saves completely or not at all.
- `ActualMinutes = null` means "not recorded", never zero.
- A block ending at or before its start runs past midnight.
- Finishing one session of a multi-session task does not finish the task.
- Every colour pairing passes the WCAG AA contrast test; colour is never the only signal.
- Every drag action has a keyboard or form alternative.
- The daily review is optional.

## Commands

```bash
cd client && npm run lint && npm run typecheck && npm test && npm run build
```

```bash
dotnet build server/ManageBagle.slnx -warnaserror && dotnet test server/ManageBagle.slnx
```

```bash
cd e2e && npm ci && npx playwright test
```
