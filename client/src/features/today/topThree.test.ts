import { describe, expect, it } from "vitest";
import type { Block, Outcome } from "../../lib/api";
import { rollingTopThree } from "./topThree";

let n = 0;
const block = (p: Partial<Block>): Block => ({
  id: `b${n++}`, date: "2026-11-25", start: "09:00", end: "10:00", title: "t", focusAreaId: null, priority: "Medium", workMode: "ShallowWork",
  status: "Planned", actualMinutes: null, plannedMinutes: 60, varianceMinutes: null, notes: "", isOutside: false, backlogTaskId: null, timeZone: null,
  version: 1, timerStartedAt: null, trackedSeconds: 0, extendedMinutes: 0, stopNote: "", breakBeforeMinutes: 0, breakAfterMinutes: 0, ...p,
} as Block);
const outcome = (rank: number, p: Partial<Outcome> = {}): Outcome => ({ rank, result: `#${rank}`, focusAreaId: null, nextAction: "", status: "Planned", minutesNeeded: null, backlogTaskId: null, ...p });
const names = (items: ReturnType<typeof rollingTopThree>["current"]) => items.map((i) => (i.kind === "outcome" ? i.outcome.result : i.block.title));

describe("rolling top three (P2-F2)", () => {
  const blocks = [
    block({ title: "Linked to #1", backlogTaskId: "t1", start: "09:00" }),
    block({ title: "Low early", priority: "Low", start: "08:00" }),
    block({ title: "High late", priority: "High", start: "15:00" }),
    block({ title: "Medium noon", priority: "Medium", start: "12:00" }),
    block({ title: "High early", priority: "High", start: "10:00" }),
  ];

  it("shows the chosen outcomes in rank order first", () => {
    const { current } = rollingTopThree([outcome(2), outcome(1, { backlogTaskId: "t1" }), outcome(3)], blocks);
    expect(names(current)).toEqual(["#1", "#2", "#3"]);
    expect(current[0]!.kind === "outcome" && current[0]!.block?.title).toBe("Linked to #1");
  });

  it("moves the next task in line up when one is finished or dropped, by priority then start time", () => {
    const { current, done } = rollingTopThree([outcome(1, { status: "Done", backlogTaskId: "t1" }), outcome(2, { status: "Skipped" }), outcome(3)], blocks);
    expect(names(current)).toEqual(["#3", "High early", "High late"]);
    expect(names(done)).toEqual(["#1", "#2"]);
  });

  it("never shows an outcome's own block as a separate item", () => {
    const { current } = rollingTopThree([outcome(1, { backlogTaskId: "t1", status: "Done" })], blocks);
    expect(names(current)).not.toContain("Linked to #1");
  });

  it("shows a task spread over several blocks once, at its next open session", () => {
    const split = [block({ title: "Write", backlogTaskId: "w", start: "09:00", status: "Done" }), block({ title: "Write", backlogTaskId: "w", start: "14:00" })];
    const { current, done } = rollingTopThree([], split);
    expect(current).toHaveLength(1);
    expect(current[0]!.kind === "block" && current[0]!.block.start).toBe("14:00");
    expect(done).toHaveLength(0);
  });

  it("lists finished blocks as done for the day", () => {
    const { current, done } = rollingTopThree([], [block({ title: "Gym", status: "Done" }), block({ title: "Call", status: "InProgress" })]);
    expect(names(current)).toEqual(["Call"]);
    expect(names(done)).toEqual(["Gym"]);
  });
});
