import type { Area, Priority, Task, WorkMode } from "../../lib/api";
import { WORK_MODES } from "../../lib/labels";
import { addDays } from "../../lib/time";

/** One line of the brain dump while it is being written. */
export interface Row {
  key: string;
  taskId: string | null;
  title: string;
  minutes: number;
  /** True once the person (or the backlog estimate) chose a length; then defaults never override it. */
  minutesChosen: boolean;
  focusAreaId: string | null;
  workMode: WorkMode;
  isOutside: boolean;
  impact: Priority;
  dueDate: string | null;
  /** A priority set by hand earlier (backlog task). Null means "follow the due date". */
  priorityOverride: Priority | null;
  /** Recovery break for this task; null follows its focus area (P2-C4). */
  breakMinutes: number | null;
  top: number | null;
}

export type SortMode = "written" | "topic" | "impact" | "due";

export const DEEP_FOCUS_MINUTES = 120;
const LEVEL: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

/**
 * Urgency comes from the due date (P2-A1): overdue, today or tomorrow is High; within a week is
 * Medium; later or no date is Low.
 */
export function priorityFromDue(due: string | null, today: string): Priority {
  if (due === null) return "Low";
  if (due <= addDays(today, 1)) return "High";
  if (due <= addDays(today, 7)) return "Medium";
  return "Low";
}

export const priorityOf = (row: Pick<Row, "dueDate"> & { priorityOverride?: Priority | null }, today: string): Priority =>
  row.priorityOverride ?? priorityFromDue(row.dueDate, today);

/** Higher is more worth doing today. Impact (value) counts most; urgency comes from the due date. */
export function valueScore(row: Pick<Row, "impact" | "dueDate"> & { priorityOverride?: Priority | null }, today: string): number {
  const urgency = 2 - LEVEL[priorityOf(row, today)];
  const overdue = row.dueDate !== null && row.dueDate < today ? 1 : 0;
  return (2 - LEVEL[row.impact]) * 5 + urgency * 2 + overdue;
}

/** P2-A2: choosing Deep focus suggests two hours, unless a length was already chosen. */
export function withWorkMode(row: Row, workMode: WorkMode): Row {
  const minutes = workMode === "DeepFocus" && !row.minutesChosen ? DEEP_FOCUS_MINUTES : row.minutes;
  return { ...row, workMode, minutes };
}

export function rowFromTask(t: Task): Row {
  return {
    key: t.id, taskId: t.id, title: t.title,
    minutes: t.estimatedMinutes ?? (t.workMode === "DeepFocus" ? DEEP_FOCUS_MINUTES : 30),
    minutesChosen: t.estimatedMinutes !== null,
    focusAreaId: t.focusAreaId, workMode: t.workMode, isOutside: t.isOutside, impact: t.impact, dueDate: t.dueDate,
    priorityOverride: t.priority, breakMinutes: t.breakMinutes, top: null,
  };
}

const NO_DATE = "9999-12-31";

/**
 * The order the list is shown in (P2-A4). Always stable: equal rows keep the order they were written
 * in, so a mode never shuffles things for no visible reason.
 */
export function sortRows(rows: Row[], mode: SortMode, areas: Area[]): Row[] {
  const written = new Map(rows.map((r, i) => [r.key, i]));
  const areaIndex = (id: string | null) => (id === null ? Number.MAX_SAFE_INTEGER : areas.findIndex((a) => a.id === id));
  const byWritten = (a: Row, b: Row) => written.get(a.key)! - written.get(b.key)!;
  const due = (r: Row) => r.dueDate ?? NO_DATE;
  const compare: Record<SortMode, (a: Row, b: Row) => number> = {
    written: byWritten,
    topic: (a, b) => areaIndex(a.focusAreaId) - areaIndex(b.focusAreaId) || WORK_MODES.indexOf(a.workMode) - WORK_MODES.indexOf(b.workMode) || byWritten(a, b),
    impact: (a, b) => LEVEL[a.impact] - LEVEL[b.impact] || due(a).localeCompare(due(b)) || byWritten(a, b),
    due: (a, b) => due(a).localeCompare(due(b)) || LEVEL[a.impact] - LEVEL[b.impact] || byWritten(a, b),
  };
  return [...rows].sort(compare[mode]);
}

/** For the topic view: consecutive runs of rows that share a focus area, in display order. */
export function topicGroups(sorted: Row[]): { focusAreaId: string | null; rows: Row[] }[] {
  const groups: { focusAreaId: string | null; rows: Row[] }[] = [];
  for (const row of sorted) {
    const last = groups.at(-1);
    if (last && last.focusAreaId === row.focusAreaId) last.rows.push(row);
    else groups.push({ focusAreaId: row.focusAreaId, rows: [row] });
  }
  return groups;
}

/** Quick picks for the due-date chip (P2-A6). */
export function dueQuickPicks(today: string): { label: string; date: string }[] {
  const weekday = new Date(`${today}T12:00:00`).getDay(); // 0 = Sunday
  const untilFriday = (5 - weekday + 7) % 7 || 7;
  const untilMonday = (1 - weekday + 7) % 7 || 7;
  return [
    { label: "Today", date: today },
    { label: "Tomorrow", date: addDays(today, 1) },
    { label: "This Friday", date: addDays(today, untilFriday) },
    { label: "Next Monday", date: addDays(today, untilMonday) },
  ];
}

/** A freshly typed line. It inherits focus area and kind of work from the line above: people dump related things in runs. */
export function newRow(key: string, title: string, last: Row | undefined): Row {
  const fresh: Row = {
    key, taskId: null, title, minutes: 30, minutesChosen: false, focusAreaId: last?.focusAreaId ?? null, workMode: "ShallowWork",
    isOutside: false, impact: "Medium", dueDate: null, priorityOverride: null, breakMinutes: null, top: null,
  };
  return withWorkMode(fresh, last?.workMode ?? "ShallowWork");
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** An open backlog task that a captured line probably repeats, so the brain dump can say so instead of duplicating it. */
export function similarTask(title: string, tasks: Task[]): Task | undefined {
  const t = normalise(title);
  if (t.length < 4) return undefined;
  return tasks.find((task) => {
    if (task.status === "Done" || task.status === "Skipped") return false;
    const other = normalise(task.title);
    return other === t || (other.length >= 6 && t.length >= 6 && (other.includes(t) || t.includes(other)));
  });
}

export interface SuggestionGroup { id: "due" | "impact" | "rest"; label: string; tasks: Task[] }

/**
 * What Plan my day offers from the backlog (P2-E2): open tasks with no time booked, in three groups —
 * overdue or due within a week (soonest first), then high impact, then the rest by value. Each task
 * appears once.
 */
export function planSuggestions(tasks: Task[], today: string): SuggestionGroup[] {
  const open = tasks.filter((t) => TaskOpen(t) && !t.scheduledDate);
  const horizon = addDays(today, 7);
  const byValue = (a: Task, b: Task) => valueScore(b, today) - valueScore(a, today) || a.createdAt.localeCompare(b.createdAt);
  const due = open.filter((t) => t.dueDate !== null && t.dueDate <= horizon).sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || byValue(a, b));
  const impact = open.filter((t) => !due.includes(t) && t.impact === "High").sort(byValue);
  const rest = open.filter((t) => !due.includes(t) && !impact.includes(t)).sort(byValue);
  return [
    { id: "due" as const, label: "Overdue and due this week", tasks: due },
    { id: "impact" as const, label: "High impact", tasks: impact },
    { id: "rest" as const, label: "Everything else", tasks: rest },
  ].filter((g) => g.tasks.length > 0);
}

const TaskOpen = (t: Task) => t.status === "Planned" || t.status === "InProgress";
