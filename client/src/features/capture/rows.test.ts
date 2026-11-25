import { describe, expect, it } from "vitest";
import type { Area, Task } from "../../lib/api";
import { dueQuickPicks, newRow, planSuggestions, priorityFromDue, similarTask, priorityOf, rowFromTask, sortRows, topicGroups, valueScore, withWorkMode, type Row } from "./rows";

const TODAY = "2026-11-25"; // a Wednesday
const areas: Area[] = [
  { id: "build", name: "Build", color: "teal", sortOrder: 0, breakMinutes: 0, breakPlacement: "After" },
  { id: "home", name: "Home", color: "slate", sortOrder: 1, breakMinutes: 0, breakPlacement: "After" },
];
let n = 0;
const row = (p: Partial<Row> = {}): Row => ({
  key: `k${n++}`, taskId: null, title: "t", minutes: 30, minutesChosen: false, focusAreaId: null, workMode: "ShallowWork",
  isOutside: false, impact: "Medium", dueDate: null, priorityOverride: null, breakMinutes: null, top: null, ...p,
});
const titles = (rows: Row[]) => rows.map((r) => r.title);

describe("priority from the due date (P2-A1)", () => {
  it.each([
    ["2026-11-20", "High"], // overdue
    ["2026-11-25", "High"], // today
    ["2026-11-26", "High"], // tomorrow
    ["2026-11-27", "Medium"],
    ["2026-12-02", "Medium"], // 7 days out
    ["2026-12-03", "Low"],
    [null, "Low"],
  ] as const)("due %s is %s", (due, expected) => expect(priorityFromDue(due, TODAY)).toBe(expected));

  it("keeps a priority someone set by hand in the backlog", () => {
    expect(priorityOf({ priorityOverride: "High", dueDate: null }, TODAY)).toBe("High");
  });

  it("ranks impact above urgency", () => {
    const valuable = row({ impact: "High", dueDate: null });
    const urgent = row({ impact: "Low", dueDate: TODAY });
    expect(valueScore(valuable, TODAY)).toBeGreaterThan(valueScore(urgent, TODAY));
  });
});

describe("deep focus default (P2-A2)", () => {
  it("suggests two hours for deep focus", () => expect(withWorkMode(row(), "DeepFocus").minutes).toBe(120));
  it("never overrides a length the person chose", () => expect(withWorkMode(row({ minutes: 45, minutesChosen: true }), "DeepFocus").minutes).toBe(45));
  it("leaves the length alone for other kinds of work", () => expect(withWorkMode(row({ minutes: 30 }), "Meeting").minutes).toBe(30));
  it("treats a backlog estimate as chosen", () => {
    const fromBacklog = rowFromTask({ id: "x", title: "x", focusAreaId: null, estimatedMinutes: 50, priority: "Low", dueDate: null, status: "Planned", nextStep: "", workMode: "ShallowWork", isOutside: false, impact: "Medium", scheduledDate: null, createdAt: "", version: 1, breakMinutes: null });
    expect(withWorkMode(fromBacklog, "DeepFocus").minutes).toBe(50);
  });
});

describe("sort modes (P2-A4)", () => {
  const list = [
    row({ title: "email", focusAreaId: "home", impact: "Low" }),
    row({ title: "ship", focusAreaId: "build", impact: "High", dueDate: "2026-12-10" }),
    row({ title: "bills", focusAreaId: "home", impact: "Medium", dueDate: "2026-11-26" }),
    row({ title: "walk", focusAreaId: null, impact: "Medium" }),
    row({ title: "tests", focusAreaId: "build", impact: "Medium", workMode: "DeepFocus", dueDate: "2026-11-26" }),
  ];

  it("as written keeps the order of entry", () => expect(titles(sortRows(list, "written", areas))).toEqual(["email", "ship", "bills", "walk", "tests"]));
  it("topic groups by focus area, deep focus first, with no area last", () =>
    expect(titles(sortRows(list, "topic", areas))).toEqual(["tests", "ship", "email", "bills", "walk"]));
  it("impact puts high impact first, then the sooner due date", () =>
    expect(titles(sortRows(list, "impact", areas))).toEqual(["ship", "bills", "tests", "walk", "email"]));
  it("due date puts the soonest first and undated last", () =>
    expect(titles(sortRows(list, "due", areas))).toEqual(["bills", "tests", "ship", "walk", "email"]));
  it("is stable: equal rows keep their written order", () => {
    const same = [row({ title: "a" }), row({ title: "b" }), row({ title: "c" })];
    for (const mode of ["topic", "impact", "due"] as const) expect(titles(sortRows(same, mode, areas))).toEqual(["a", "b", "c"]);
  });
  it("topic view produces one heading per focus area", () => {
    const groups = topicGroups(sortRows(list, "topic", areas));
    expect(groups.map((g) => g.focusAreaId)).toEqual(["build", "home", null]);
  });
});

describe("due-date quick picks (P2-A6)", () => {
  it("offers today, tomorrow, this Friday and next Monday", () =>
    expect(dueQuickPicks(TODAY).map((p) => p.date)).toEqual(["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-30"]));
  it("on a Friday, 'this Friday' means next week's", () => expect(dueQuickPicks("2026-11-27")[2]!.date).toBe("2026-12-04"));
});

const task = (p: Partial<Task>): Task => ({
  id: `t${n++}`, title: "task", focusAreaId: null, estimatedMinutes: 30, priority: "Low", dueDate: null, status: "Planned", nextStep: "", workMode: "ShallowWork",
  isOutside: false, impact: "Medium", scheduledDate: null, createdAt: "2026-11-01T00:00:00Z", version: 1, breakMinutes: null, ...p,
});

describe("plan my day suggests from the backlog (P2-E2)", () => {
  const tasks = [
    task({ title: "Later, high impact", impact: "High", dueDate: "2026-12-20" }),
    task({ title: "Due Friday", dueDate: "2026-11-27" }),
    task({ title: "Overdue", dueDate: "2026-11-20" }),
    task({ title: "Someday" }),
    task({ title: "Already booked", dueDate: "2026-11-25", scheduledDate: "2026-11-25" }),
    task({ title: "Finished", dueDate: "2026-11-25", status: "Done" }),
  ];
  it("groups open, unbooked tasks: due soon first, then high impact, then the rest", () => {
    expect(planSuggestions(tasks, TODAY).map((g) => [g.id, g.tasks.map((t) => t.title)])).toEqual([
      ["due", ["Overdue", "Due Friday"]],
      ["impact", ["Later, high impact"]],
      ["rest", ["Someday"]],
    ]);
  });
  it("leaves out empty groups", () => expect(planSuggestions([task({ title: "Someday" })], TODAY).map((g) => g.id)).toEqual(["rest"]));
});

describe("brain dump capture (P2-E1)", () => {
  it("spots a line that repeats an open backlog task", () => {
    const open = [task({ title: "Renew passport!" }), task({ title: "Call the bank", status: "Done" })];
    expect(similarTask("renew passport", open)?.title).toBe("Renew passport!");
    expect(similarTask("Renew passport before trip", open)?.title).toBe("Renew passport!");
    expect(similarTask("Call the bank", open)).toBeUndefined(); // finished tasks do not count
    expect(similarTask("tax", [task({ title: "tax" })])).toBeUndefined(); // too short to judge
  });
  it("starts a new line with the focus area and kind of work of the one above", () => {
    const above = row({ focusAreaId: "build", workMode: "DeepFocus" });
    const fresh = newRow("x", "Next thing", above);
    expect([fresh.focusAreaId, fresh.workMode, fresh.minutes]).toEqual(["build", "DeepFocus", 120]);
  });
});
