import { describe, expect, it } from "vitest";
import { outsideBuffer, proposeSchedule, type PlanDraft } from "./schedule";

const draft = (key: string, minutes: number, extra: Partial<PlanDraft> = {}): PlanDraft => ({ key, minutes, workMode: "ShallowWork", isOutside: false, top: null, ...extra });
const at = (h: number, m = 0) => h * 60 + m;

describe("proposeSchedule", () => {
  it("lays tasks out back to back with a short breather", () => {
    const { slots, unplaced } = proposeSchedule([draft("a", 30), draft("b", 45)], [], at(9));
    expect(slots.get("a")).toMatchObject({ start: at(9), end: at(9, 30) });
    expect(slots.get("b")).toMatchObject({ start: at(9, 35), end: at(10, 20) });
    expect(unplaced).toEqual([]);
  });

  it("puts the top three first, then deep focus, then the rest", () => {
    const { slots } = proposeSchedule(
      [draft("email", 15), draft("deep", 60, { workMode: "DeepFocus" }), draft("second", 30, { top: 2 }), draft("first", 30, { top: 1 })],
      [],
      at(9),
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
    const orderOf = (batch: boolean) => [...proposeSchedule(items, [], at(9), batch).slots.entries()].sort((a, b) => a[1].start - b[1].start).map(([key]) => key);
    expect(orderOf(true)).toEqual(["top", "build-2", "build-1", "admin-1", "admin-2"]); // one switch instead of three
    expect(orderOf(false)).toEqual(["top", "build-2", "build-1", "admin-1", "admin-2"]);
    // Without batching, interleaved shallow tasks stay interleaved:
    const mixed = [draft("a1", 15, { topic: "a" }), draft("b1", 15, { topic: "b" }), draft("a2", 15, { topic: "a" })];
    const order = (batch: boolean) => [...proposeSchedule(mixed, [], at(9), batch).slots.entries()].sort((x, y) => x[1].start - y[1].start).map(([key]) => key);
    expect(order(false)).toEqual(["a1", "b1", "a2"]);
    expect(order(true)).toEqual(["a1", "a2", "b1"]);
  });

  it("works around what is already booked, using gaps that are big enough", () => {
    const { slots } = proposeSchedule([draft("long", 90), draft("short", 20)], [[at(9, 30), at(10, 30)]], at(9));
    expect(slots.get("long")!.start).toBe(at(10, 30)); // does not fit in the 30 minutes before the meeting
    expect(slots.get("short")).toMatchObject({ start: at(9), end: at(9, 20) }); // but this does
  });

  it("gives outside work a buffer", () => {
    expect(outsideBuffer(20)).toBe(10); // never less than 10 minutes
    expect(outsideBuffer(60)).toBe(15);
    expect(outsideBuffer(90)).toBe(25); // rounded up to a 5-minute step
    const { slots } = proposeSchedule([draft("errand", 60, { isOutside: true })], [], at(14));
    expect(slots.get("errand")).toEqual({ start: at(14), end: at(15, 15), buffer: 15 });
  });

  it("leaves what does not fit today unplaced instead of running past midnight", () => {
    const { slots, unplaced } = proposeSchedule([draft("a", 60), draft("b", 120)], [], at(22), false);
    expect(slots.has("a")).toBe(true);
    expect(unplaced).toEqual(["b"]);
  });

  it("starts on a 5-minute step even when asked mid-step", () => {
    const { slots } = proposeSchedule([draft("a", 25)], [], at(9, 2));
    expect(slots.get("a")).toMatchObject({ start: at(9, 5), end: at(9, 30) });
  });
});
