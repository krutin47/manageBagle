import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/** Parses tokens.css so the test checks the real shipped values, not a copy. */
function readTokens(theme: "light" | "dark"): Record<string, string> {
  const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8");
  const [light, dark] = css.split(':root[data-theme="dark"]');
  const tokens: Record<string, string> = {};
  for (const m of light.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) tokens[m[1]] = m[2];
  if (theme === "dark") for (const m of dark.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)) tokens[m[1]] = m[2];
  return tokens;
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const AREAS = ["teal", "blue", "violet", "rose", "orange", "amber", "green", "slate", "none"];
const SURFACES = ["canvas", "surface", "sunken", "hover"];

/** [foreground, background, minimum ratio] — 4.5 for text (SC 1.4.3), 3 for UI marks (SC 1.4.11). */
const pairs: [string, string, number][] = [
  ...SURFACES.flatMap((s): [string, string, number][] => [
    ["ink", s, 7],
    ["ink-2", s, 4.5],
    ["ink-3", s, 4.5],
    ["accent-ink", s, 4.5],
    ["good", s, 4.5],
    ["warn", s, 4.5],
    ["bad", s, 4.5],
    ["focus", s, 3],
    ["line-strong", s, 3],
  ]),
  ["on-ink", "ink", 7],
  ["on-accent", "accent", 4.5],
  ["on-accent", "accent-hover", 4.5],
  ["accent", "surface", 3],
  ["accent", "canvas", 3],
  ["accent-ink", "accent-tint", 4.5],
  ["good", "good-tint", 4.5],
  ["warn", "warn-tint", 4.5],
  ["bad", "bad-tint", 4.5],
  ...AREAS.flatMap((a): [string, string, number][] => [
    [`area-${a}-ink`, `area-${a}-tint`, 4.5],
    [`area-${a}-solid`, "surface", 3],
    [`area-${a}-solid`, "canvas", 3],
    [`area-${a}-solid`, `area-${a}-tint`, 3],
  ]),
];

describe.each(["light", "dark"] as const)("WCAG AA contrast — %s theme", (theme) => {
  const t = readTokens(theme);
  it.each(pairs)("%s on %s is at least %s:1", (fg, bg, min) => {
    expect(t[fg], `missing token --${fg}`).toBeDefined();
    expect(t[bg], `missing token --${bg}`).toBeDefined();
    const ratio = contrast(t[fg], t[bg]);
    expect(ratio, `${t[fg]} on ${t[bg]} = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(min);
  });
});
