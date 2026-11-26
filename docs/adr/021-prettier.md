# ADR-021: Prettier formats the client, browser tests and scripts

- **Status:** Accepted — implemented
- **Date:** 2026-11-25
- **Source:** product owner: "yes"; handbook Phase 2, "formatting and analyzers"

## Decision

- Prettier 3.9.10 (pinned, dev dependency of `client/`) formats TypeScript, CSS, JSON and Markdown in
  `client/` and the browser tests in `e2e/`. One shared `.prettierrc.json` at the repository root.
- `printWidth: 120`: the codebase was written to about that width; 80 would rewrap most JSX.
- Everything was reformatted in **one commit that changes no behaviour**, so it can be skipped when
  reading history (`git blame --ignore-rev`; the commit is listed in `.git-blame-ignore-revs`).
- CI fails if a file is not formatted (`npm run format:check`). ESLint keeps correctness rules only;
  it has no style rules to conflict with.
- Not formatted: generated files (`src/lib/api.generated.ts`, written by its own generator and checked
  by a test), build output, and the C# server (its style is `.editorconfig` plus warnings-as-errors).
