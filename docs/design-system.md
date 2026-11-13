# Design system

The source of truth is `client/src/styles/tokens.css`.

## Colour

Warm paper surfaces, near-black ink, one accent ("toasted crust"), three reserved status colours,
and eight focus-area hues. Light and dark are separately chosen, not inverted.

**Accessibility is tested, not asserted.** `client/src/styles/contrast.test.ts` reads the real
token file and checks 81 foreground/background pairings per theme against WCAG 2.2 AA:

- body and secondary text ≥ 4.5:1 (primary text ≥ 7:1) on every surface it appears on
- text on each focus-area tint ≥ 4.5:1
- non-text marks (area colour bars, focus ring, input borders) ≥ 3:1

Change a token and `npm test` reports any pairing that no longer passes.

Colour is never the only signal: statuses always carry an icon and a word, focus areas always show
their name, done/skipped blocks also change text decoration and fill pattern. Eight hues cannot all
be told apart under colour-vision deficiency, which is why the name is always there too.

## Type

- **Bricolage Grotesque** – headings and large figures
- **Geist** – interface text
- **Geist Mono** – clock times and table figures (tabular)

All three are self-hosted (no third-party font requests).

## Motion

Motion explains a change: where a page came from, which item was added or removed, that a figure
updated. Durations are 120–300 ms with an ease-out curve or a stiff spring.
`prefers-reduced-motion` turns off both CSS and Motion animations.

## Interaction rules

- Everything works by keyboard; focus rings are always visible (2 px, ≥ 3:1).
- Dialogs trap focus and close on Escape (Radix).
- Ticking a block or outcome updates instantly and rolls back if the server refuses.
- Fields that save on blur show a "Saved" confirmation.
- Layout adapts at 860 px: the sidebar becomes a bottom bar and the week calendar shows one day.
