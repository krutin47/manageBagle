import type { WorkMode } from "./api";

export interface PlanDraft {
  key: string;
  minutes: number;
  workMode: WorkMode;
  isOutside: boolean;
  /** 1–3 for the day's top three, otherwise null. */
  top: number | null;
  /** Topic to batch by (the focus area). Tasks sharing one are kept next to each other. */
  topic?: string | null;
}

export interface Slot {
  start: number;
  end: number;
  /** Extra minutes added on top of the estimate for outside work. */
  buffer: number;
}

const ceil5 = (n: number) => Math.ceil(n / 5) * 5;

/** Outside work gets a quarter more time, at least 10 minutes: queues, traffic and people are not on your schedule. */
export const outsideBuffer = (minutes: number) => Math.max(10, ceil5(minutes * 0.25));

export const BREATHER = 5;
export const DAY_END = 24 * 60 - 5;

/**
 * Fits tasks into the free time of a day.
 * Order: the top three first (the day's reason for existing). After that, with batching on, topic by
 * topic so related work sits together and context switches drop — deep focus first inside a topic;
 * with batching off, deep focus first and then everything else as written. Each task takes the first gap that holds it; whatever does
 * not fit before the end of the day is returned as unplaced and stays in the backlog.
 */
export function proposeSchedule(items: PlanDraft[], busy: [number, number][], from: number, batch = false, dayEnd = DAY_END): { slots: Map<string, Slot>; unplaced: string[] } {
  const taken = busy.map(([s, e]) => [s, e] as [number, number]);
  const slots = new Map<string, Slot>();
  const unplaced: string[] = [];

  // Topics keep the order in which they were first written down.
  const topics = [...new Set(items.filter((d) => d.top === null).map((d) => d.topic ?? ""))];
  const topicRank = (d: PlanDraft) => (batch ? topics.indexOf(d.topic ?? "") : 0);
  const modeRank = (d: PlanDraft) => (d.workMode === "DeepFocus" ? 0 : 1);
  const ordered = items
    .map((d, i) => ({ d, i }))
    .sort((a, b) => {
      if (a.d.top !== null || b.d.top !== null) return (a.d.top ?? 99) - (b.d.top ?? 99) || a.i - b.i;
      return topicRank(a.d) - topicRank(b.d) || modeRank(a.d) - modeRank(b.d) || a.i - b.i;
    });

  for (const { d } of ordered) {
    const buffer = d.isOutside ? outsideBuffer(d.minutes) : 0;
    const length = ceil5(d.minutes) + buffer;
    let start = ceil5(Math.max(0, from));
    for (;;) {
      const clash = taken.filter(([s, e]) => s < start + length && e > start).sort((a, b) => b[1] - a[1])[0];
      if (!clash) break;
      start = ceil5(clash[1]);
    }
    if (start + length > dayEnd) {
      unplaced.push(d.key);
      continue;
    }
    slots.set(d.key, { start, end: start + length, buffer });
    taken.push([start, start + length + BREATHER]);
  }
  return { slots, unplaced };
}
