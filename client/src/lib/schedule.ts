import type { TaskPolicy, WorkMode } from "./api";

export interface PlanDraft {
  key: string;
  minutes: number;
  workMode: WorkMode;
  isOutside: boolean;
  /** 1–3 for the day's top three, otherwise null. */
  top: number | null;
  /** Topic to batch by (the focus area). Tasks sharing one are kept next to each other. */
  topic?: string | null;
  /** Recovery break reserved next to the task (P2-C4). */
  breakMinutes?: number;
  breakPlacement?: "Before" | "After";
}

/** Time already spoken for: a routine occurrence, in minutes from the plan date's midnight. */
export interface Commitment {
  start: number;
  end: number;
  policy: TaskPolicy;
  /** For "SelectedAreas": the focus areas that may go inside. */
  areaIds: string[];
  title: string;
}

export interface Slot {
  start: number;
  end: number;
  /** Extra minutes added on top of the estimate for outside work. */
  buffer: number;
  breakBefore: number;
  breakAfter: number;
  /** Title of the routine the task was placed inside, if any. */
  within?: string;
}

export interface FitOptions {
  /** Earliest start, e.g. "now" on today. */
  from: number;
  /** Existing blocks, including the recovery breaks they reserve. */
  busy?: [number, number][];
  commitments?: Commitment[];
  /** The part of the day automatic planning may use (P2-C3). */
  dayStart?: number;
  dayEnd?: number;
  /** Keep tasks of the same topic together (after the top three). */
  batch?: boolean;
}

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;

/** Outside work gets a quarter more time, at least 10 minutes: queues, traffic and people are not on your schedule. */
export const outsideBuffer = (minutes: number) => Math.max(10, ceil5(minutes * 0.25));

export const BREATHER = 5;
export const DAY_END = 24 * 60 - 5;

const accepts = (c: Commitment, area: string | null | undefined) =>
  c.policy === "AnyTask" || (c.policy === "SelectedAreas" && !!area && c.areaIds.includes(area));

/**
 * Fits tasks into the free time of a day.
 *
 * Order: the top three first (the day's reason for existing). After that, with batching on, topic by
 * topic so related work sits together — deep focus first inside a topic; with batching off, deep focus
 * first and then everything else as written.
 *
 * Where: never inside a routine that does not accept the task; inside a routine that names the task's
 * focus area first (work hours for work tasks); otherwise the first gap that holds the task and its
 * recovery break, within the day window. Whatever does not fit is returned as unplaced and stays in
 * the backlog.
 */
export function proposeSchedule(
  items: PlanDraft[],
  options: FitOptions,
): { slots: Map<string, Slot>; unplaced: string[] } {
  const { from, busy = [], commitments = [], dayStart = 0, dayEnd = DAY_END, batch = false } = options;
  const taken = busy.map(([s, e]) => [s, e] as [number, number]);
  const slots = new Map<string, Slot>();
  const unplaced: string[] = [];

  const topics = [...new Set(items.filter((d) => d.top === null).map((d) => d.topic ?? ""))];
  const topicRank = (d: PlanDraft) => (batch ? topics.indexOf(d.topic ?? "") : 0);
  const modeRank = (d: PlanDraft) => (d.workMode === "DeepFocus" ? 0 : 1);
  const ordered = items
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      if (a.d.top !== null || b.d.top !== null) return (a.d.top ?? 99) - (b.d.top ?? 99) || a.i - b.i;
      return topicRank(a.d) - topicRank(b.d) || modeRank(a.d) - modeRank(b.d) || a.i - b.i;
    });

  const earliest = ceil5(Math.max(0, from, dayStart));

  for (const { d } of ordered) {
    const buffer = d.isOutside ? outsideBuffer(d.minutes) : 0;
    const length = ceil5(d.minutes) + buffer;
    const brk = d.breakMinutes ?? 0;
    const before = d.breakPlacement === "Before" ? brk : 0;
    const after = d.breakPlacement === "Before" ? 0 : brk;
    const closed = commitments.filter((c) => !accepts(c, d.topic));

    /** First start ≥ `start` where the work avoids closed routines and the work plus its break avoid other tasks. */
    const firstFit = (start: number, limit: number): number | null => {
      let s = ceil5(start);
      for (let guard = 0; guard < 400; guard++) {
        if (s + length > limit) return null;
        const routineClash = closed.filter((c) => c.start < s + length && c.end > s).sort((a, b) => b.end - a.end)[0];
        if (routineClash) {
          s = ceil5(routineClash.end);
          continue;
        }
        const taskClash = taken
          .filter(([ts, te]) => ts < s + length + after && te > s - before)
          .sort((a, b) => b[1] - a[1])[0];
        if (taskClash) {
          s = ceil5(taskClash[1] + before);
          continue;
        }
        return s;
      }
      return null;
    };

    // Prefer a routine made for this kind of work.
    let start: number | null = null;
    let within: string | undefined;
    for (const home of commitments
      .filter((c) => c.policy === "SelectedAreas" && accepts(c, d.topic))
      .sort((a, b) => a.start - b.start)) {
      const s = firstFit(Math.max(earliest, home.start), Math.min(home.end, Math.max(dayEnd, home.end)));
      if (s !== null) {
        start = s;
        within = home.title;
        break;
      }
    }
    start ??= firstFit(earliest, dayEnd);

    if (start === null) {
      unplaced.push(d.key);
      continue;
    }
    within ??= commitments.find((c) => c.policy === "AnyTask" && c.start <= start! && c.end >= start! + length)?.title;
    slots.set(d.key, { start, end: start + length, buffer, breakBefore: before, breakAfter: after, within });
    taken.push([start - before, start + length + after + BREATHER]);
  }
  return { slots, unplaced };
}
