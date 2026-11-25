import { afterEach, describe, expect, it } from "vitest";
import { dueSeconds, elapsedSeconds, formatClock, syncServerClock } from "./timerClock";

describe("timer clock", () => {
  afterEach(() => syncServerClock(new Date().toISOString()));

  it("adds the current run to what was banked", () => {
    const now = Date.parse("2026-11-26T09:30:00Z");
    syncServerClock("2026-11-26T09:30:00Z", now);
    expect(elapsedSeconds({ trackedSeconds: 600, timerStartedAt: "2026-11-26T09:20:00Z" }, now)).toBe(600 + 600);
    expect(elapsedSeconds({ trackedSeconds: 600, timerStartedAt: null }, now)).toBe(600);
  });

  it("measures against the server's clock when the device clock is wrong", () => {
    const deviceNow = Date.parse("2026-11-26T09:35:00Z"); // device is 5 minutes fast
    syncServerClock("2026-11-26T09:30:00Z", deviceNow);
    expect(elapsedSeconds({ trackedSeconds: 0, timerStartedAt: "2026-11-26T09:29:00Z" }, deviceNow)).toBe(60);
  });

  it("is due at the planned length plus any extension", () => expect(dueSeconds({ plannedMinutes: 60, extendedMinutes: 15 })).toBe(4500));

  it.each([
    [0, "0:00"],
    [75, "1:15"],
    [3599, "59:59"],
    [3725, "1:02:05"],
  ])("formats %i seconds as %s", (seconds, text) => expect(formatClock(seconds)).toBe(text));
});
