import { describe, expect, it } from "vitest";
import { remindersBetween } from "./reminders";

const at = (h: number, m = 0) => h * 60 + m;
const plan = { dayStart: at(8), dayEnd: at(21), waterEvery: 60, meals: [{ title: "Lunch", start: at(12, 30) }] };

describe("reminders", () => {
  it("reminds about water every interval from the start of the day", () =>
    expect(remindersBetween(at(8), at(11), plan).filter((r) => r.kind === "water").map((r) => r.at)).toEqual([at(9), at(10), at(11)]));

  it("never reminds outside the day window", () => {
    expect(remindersBetween(at(20, 30), at(23), plan)).toEqual([]);
    expect(remindersBetween(at(0), at(8), plan)).toEqual([]);
  });

  it("reminds when a meal routine starts", () => {
    const due = remindersBetween(at(12, 25), at(12, 30), plan);
    expect(due).toHaveLength(1);
    expect(due[0]).toMatchObject({ kind: "meal", title: "Lunch time" });
  });

  it("does not repeat what was already due before the window", () => expect(remindersBetween(at(9), at(9, 30), plan)).toEqual([]));

  it("is quiet when water reminders are off", () =>
    expect(remindersBetween(at(8), at(21), { ...plan, waterEvery: null }).map((r) => r.kind)).toEqual(["meal"]));
});
