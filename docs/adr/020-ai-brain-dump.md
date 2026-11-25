# ADR-020: The AI brain dump suggests tasks; the person confirms; spend is capped

- **Status:** Accepted — implemented; on only when an Anthropic API key is configured
- **Date:** 2026-11-25
- **Source:** product owner: "monthly budget should not cross more than $10. It should be used only
  to understand the text and create tasks based on the text"; P3-AI1 and P3-AI2; ADR-012

## Decision

- **Paragraph to tasks (P3-AI1).** "Turn into tasks" sends the paragraph, today's date and the
  names of the person's focus areas to Claude, which returns tasks in a strict JSON schema
  (structured outputs). The server checks every field again (length, kind, focus area, due date)
  and returns suggestions. **Nothing is saved**: they appear as brain-dump lines the person edits,
  removes or keeps, then saves as usual.
- **Voice (P3-AI2)** uses the browser's own speech recognition (free; in Chrome the audio is
  processed by Google, in Safari by Apple). It only fills the text box, so it works without AI too.
  Photos (P3-AI3) are not built.
- **Model:** `claude-opus-5-5` by default (`Ai:Model`). The owner may choose `claude-haiku-5-5`,
  which costs about 1/40th as much per request and would fit far more uses in the same budget.
  Effort is `low`: extraction is a simple task.
- **Spend caps:** every call's tokens are recorded (`AiUsage`) and priced; when the month's estimate
  reaches `Ai:MonthlyBudgetUsd` (default 10) the feature pauses until the next month. Each person may
  use it `Ai:DailyLimitPerUser` times a day (default 20). The Anthropic console's spend limit is the
  hard ceiling behind both.
- **Refusals:** server-side fallbacks (`fallbacks: "default"`) re-serve a request a safety classifier
  declines; if it still ends in a refusal the person is told the text could not be turned into tasks.
- **Privacy:** text leaves the app only when the person presses the button, and only that text plus
  focus-area names and the date. No email, no id, no other tasks. Not stored by the app.
- **Dependency:** the official `Anthropic` NuGet SDK (13.8.0), as Anthropic recommends for C#.
- **Off by default:** without `Ai:AnthropicApiKey` the button is not shown and nothing changes.

## Alternatives rejected

A local model (an instance able to run one costs more than US$10 a month to host); a cheaper model
chosen without the owner (a quality-versus-cost decision that is theirs); saving the suggestions
directly (ADR-012: suggestions only, the person confirms).
