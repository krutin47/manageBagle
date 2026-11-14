import { describe, expect, it } from "vitest";
import type { Block } from "../../lib/api";
import { plannedMinutes } from "../../lib/time";
import { placeBlocks } from "./layout";

const block = (id: string, start: string, end: string): Block => ({
  id, date: "2026-11-16", start, end, title: id, focusAreaId: null, priority: "Medium", workMode: "DeepFocus", status: "Planned",
  actualMinutes: null, plannedMinutes: plannedMinutes(start, end), varianceMinutes: null, notes: "", isOutside: false, backlogTaskId: null,
});

describe("placeBlocks", () => {
  it("gives back-to-back blocks the full width", () => {
    const placed = placeBlocks([block("a", "09:00", "10:00"), block("b", "10:00", "11:00")]);
    expect(placed.map((p) => [p.lane, p.lanes])).toEqual([[0, 1], [0, 1]]);
  });

  it("puts overlapping blocks side by side and reuses a lane once it frees up", () => {
    const placed = placeBlocks([block("a", "09:00", "11:00"), block("b", "09:30", "10:00"), block("c", "10:15", "10:45")]);
    const by = Object.fromEntries(placed.map((p) => [p.block.id, p]));
    expect(by.a.lane).toBe(0);
    expect(by.b.lane).toBe(1);
    expect(by.c.lane).toBe(1);
    expect(placed.every((p) => p.lanes === 2)).toBe(true);
  });

  it("clips a block that runs past midnight at the end of the day", () => {
    const [p] = placeBlocks([block("late", "23:00", "00:30")]);
    expect(p.endMin).toBe(1440);
    expect(p.overnight).toBe(true);
  });
});
