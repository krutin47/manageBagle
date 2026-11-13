import { describe, expect, it } from "vitest";
import { addDays, formatDuration, formatHours, fromMinutes, isValidISODate, plannedMinutes, snap, toMinutes, weekDays, weekStart } from "./time";

describe("time helpers", () => {
  it("finds the Monday of any week", () => {
    expect(weekStart("2026-11-16")).toBe("2026-11-16"); // Monday
    expect(weekStart("2026-11-18")).toBe("2026-11-16");
    expect(weekStart("2026-11-22")).toBe("2026-11-16"); // Sunday belongs to the week that started Monday
    expect(weekStart("2026-11-23")).toBe("2026-11-23");
  });

  it("walks across month, year and DST boundaries", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-29", 1)).toBe("2026-03-30");
    expect(addDays("2026-10-25", 1)).toBe("2026-10-26");
    expect(weekDays("2026-11-30")[6]).toBe("2026-12-06");
  });

  it("computes planned minutes, wrapping past midnight like the workbook", () => {
    expect(plannedMinutes("09:00", "10:30")).toBe(90);
    expect(plannedMinutes("23:30", "00:15")).toBe(45);
    expect(plannedMinutes("09:00:00", "09:05:00")).toBe(5);
  });

  it("converts and snaps", () => {
    expect(toMinutes("18:45")).toBe(1125);
    expect(fromMinutes(1125)).toBe("18:45");
    expect(fromMinutes(1440 + 30)).toBe("00:30");
    expect(snap(547, 15)).toBe(540);
    expect(snap(548, 15)).toBe(555);
  });

  it("formats durations for people", () => {
    expect(formatDuration(45)).toBe("45m");
    expect(formatDuration(60)).toBe("1h");
    expect(formatDuration(95)).toBe("1h 35m");
    expect(formatDuration(-15)).toBe("−15m");
    expect(formatHours(135)).toBe("2.3");
    expect(formatHours(120)).toBe("2");
  });

  it("rejects impossible dates", () => {
    expect(isValidISODate("2026-02-30")).toBe(false);
    expect(isValidISODate("2026-11-16")).toBe(true);
    expect(isValidISODate("yesterday")).toBe(false);
  });
});
