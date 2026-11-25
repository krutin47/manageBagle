import { describe, expect, it } from "vitest";
import type { Commitment } from "./api";
import { clashesFor, clashLabel, commitmentsOn } from "./commitments";

const DAY = "2026-11-26";
const c = (
  title: string,
  start: string,
  minutes: number,
  taskPolicy: Commitment["taskPolicy"],
  areaIds: string[] = [],
  kind: Commitment["kind"] = "routine",
): Commitment => ({
  kind,
  sourceId: title,
  title,
  date: DAY,
  start,
  end: "",
  minutes,
  taskPolicy,
  areaIds,
  isMeal: false,
  color: null,
});
const fixed = commitmentsOn(DAY, [
  c("Lunch", "12:30:00", 45, "NoTasks"),
  c("Work hours", "09:00:00", 480, "SelectedAreas", ["build"]),
  c("Open slot", "18:00:00", 60, "AnyTask"),
  c("Team sync", "15:00:00", 30, "NoTasks", [], "event"),
]);
const titles = (start: string, minutes: number, focusAreaId: string | null = "build") =>
  clashesFor({ start, plannedMinutes: minutes, focusAreaId }, fixed).map((x) => x.title);

describe("blocks that run into fixed time are flagged (handbook §1)", () => {
  it("flags a protected routine and a meeting", () => {
    expect(titles("12:00", 60)).toEqual(["Lunch"]);
    expect(titles("14:45", 30)).toEqual(["Team sync"]);
  });
  it("does not flag a block that only touches the edge", () => expect(titles("11:30", 60)).toEqual([]));
  it("flags a routine that only takes other focus areas", () => {
    expect(titles("10:00", 30, "home")).toEqual(["Work hours"]);
    expect(titles("10:00", 30, null)).toEqual(["Work hours"]);
    expect(titles("10:00", 30, "build")).toEqual([]);
  });
  it("never flags a routine open to any task", () => expect(titles("18:15", 30)).toEqual([]));
  it("names every clash", () =>
    expect(clashLabel([{ title: "Lunch" }, { title: "Team sync" }])).toBe("Overlaps Lunch and Team sync"));
});
