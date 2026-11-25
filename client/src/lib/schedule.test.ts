import { describe, expect, it } from "vitest";
import { outsideBuffer, proposeSchedule, type Commitment, type PlanDraft } from "./schedule";

const draft = (key: string, minutes: number, extra: Partial<PlanDraft> = {}): PlanDraft => ({ key, minutes, workMode: "ShallowWork", isOutside: false, top: null, ...extra });
const at = (h: number, m = 0) => h * 60 + m;

describe("proposeSchedule", () => {
  it("lays tasks out back to back with a short breather", () => {
    const { slots, unplaced } = proposeSchedule([draft("a", 30), draft("b", 45)], { busy: [], from: at(9) });
    expect(slots.get("a")).toMatchObject({ start: at(9), end: at(9, 30) });
    expect(slots.get("b")).toMatchObject({ start: at(9, 35), end: at(10, 20) });
    expect(unplaced).toEqual([]);
  });

  it("puts the top three first, then deep focus, then the rest", () => {
    const { slots } = proposeSchedule(
      [draft("email", 15), draft("deep", 60, { workMode: "DeepFocus" }), draft("second", 30, { top: 2 }), draft("first", 30, { top: 1 })],
      { from: at(9) },
    );
    const order = [...slots.entries()].sort((a, b) => a[1].start - b[1].start).map(([key]) => key);
    expect(order).toEqual(["first", "second", "deep", "email"]);
  });

  it("batches by topic so related work sits together", () => {
    const items = [
      draft("build-1", 30, { topic: "build" }),
      draft("admin-1", 15, { topic: "admin" }),
      draft("build-2", 30, { topic: "build", workMode: "DeepFocus" }),
      draft("admin-2", 15, { topic: "admin" }),
      draft("top", 30, { top: 1, topic: "admin" }),
    ];
    const orderOf = (batch: boolean) => [...proposeSchedule(items, { busy: [], from: at(9), batch: batch }).slots.entries()].sort((a, b) => a[1].start - b[1].start).map(([key]) => key);
    expect(orderOf(true)).toEqual(["top", "build-2", "build-1", "admin-1", "admin-2"]); // one switch instead of three
    expect(orderOf(false)).toEqual(["top", "build-2", "build-1", "admin-1", "admin-2"]);
    // Without batching, interleaved shallow tasks stay interleaved:
    const mixed = [draft("a1", 15, { topic: "a" }), draft("b1", 15, { topic: "b" }), draft("a2", 15, { topic: "a" })];
    const order = (batch: boolean) => [...proposeSchedule(mixed, { busy: [], from: at(9), batch: batch }).slots.entries()].sort((x, y) => x[1].start - y[1].start).map(([key]) => key);
    expect(order(false)).toEqual(["a1", "b1", "a2"]);
    expect(order(true)).toEqual(["a1", "a2", "b1"]);
  });

  it("works around what is already booked, using gaps that are big enough", () => {
    const { slots } = proposeSchedule([draft("long", 90), draft("short", 20)], { busy: [[at(9, 30), at(10, 30)]], from: at(9) });
    expect(slots.get("long")!.start).toBe(at(10, 30)); // does not fit in the 30 minutes before the meeting
    expect(slots.get("short")).toMatchObject({ start: at(9), end: at(9, 20) }); // but this does
  });

  it("gives outside work a buffer", () => {
    expect(outsideBuffer(20)).toBe(10); // never less than 10 minutes
    expect(outsideBuffer(60)).toBe(15);
    expect(outsideBuffer(90)).toBe(25); // rounded up to a 5-minute step
    const { slots } = proposeSchedule([draft("errand", 60, { isOutside: true })], { busy: [], from: at(14) });
    expect(slots.get("errand")).toMatchObject({ start: at(14), end: at(15, 15), buffer: 15 });
  });

  it("leaves what does not fit today unplaced instead of running past midnight", () => {
    const { slots, unplaced } = proposeSchedule([draft("a", 60), draft("b", 120)], { busy: [], from: at(22), batch: false });
    expect(slots.has("a")).toBe(true);
    expect(unplaced).toEqual(["b"]);
  });

  it("starts on a 5-minute step even when asked mid-step", () => {
    const { slots } = proposeSchedule([draft("a", 25)], { busy: [], from: at(9, 2) });
    expect(slots.get("a")).toMatchObject({ start: at(9, 5), end: at(9, 30) });
  });

  it("never places a task inside a routine that does not take it", () => {
    const lunch: Commitment = { start: at(12, 30), end: at(13, 15), policy: "NoTasks", areaIds: [], title: "Lunch" };
    const { slots } = proposeSchedule([draft("a", 60)], { from: at(12), commitments: [lunch] });
    expect(slots.get("a")).toMatchObject({ start: at(13, 15) }); // the 30 minutes before lunch are too short
  });

  it("puts work into the routine made for it, and keeps other work out", () => {
    const work: Commitment = { start: at(9), end: at(17), policy: "SelectedAreas", areaIds: ["career"], title: "Work hours" };
    const { slots } = proposeSchedule(
      [draft("apply", 60, { topic: "career" }), draft("laundry", 30, { topic: "home" })],
      { from: at(7), commitments: [work], dayEnd: at(21) },
    );
    expect(slots.get("apply")).toMatchObject({ start: at(9), within: "Work hours" });
    expect(slots.get("laundry")).toMatchObject({ start: at(7) }); // before work, not inside it
  });

  it("stays inside the day window and leaves what does not fit", () => {
    const { slots, unplaced } = proposeSchedule([draft("a", 60), draft("b", 60)], { from: at(5), dayStart: at(8), dayEnd: at(9, 30) });
    expect(slots.get("a")).toMatchObject({ start: at(8) });
    expect(unplaced).toEqual(["b"]);
  });

  it("reserves recovery breaks so the next task does not start straight away", () => {
    const { slots } = proposeSchedule(
      [draft("deep", 60, { breakMinutes: 15, breakPlacement: "After" }), draft("next", 30), draft("warmup", 30, { breakMinutes: 10, breakPlacement: "Before" })],
      { from: at(9) },
    );
    expect(slots.get("deep")).toMatchObject({ start: at(9), end: at(10), breakAfter: 15 });
    expect(slots.get("next")).toMatchObject({ start: at(10, 20) }); // 15 min break + 5 min breather
    expect(slots.get("warmup")).toMatchObject({ start: at(11, 5), breakBefore: 10 }); // 10:55 breather end + 10 min before
  });
});
