import type { Block, Outcome, Priority, Status } from "../../lib/api";
import { toMinutes } from "../../lib/time";

export type FocusItem =
  | { kind: "outcome"; key: string; outcome: Outcome; block?: Block; status: Status }
  | { kind: "block"; key: string; block: Block; status: Status };

const open = (s: Status) => s === "Planned" || s === "InProgress";
const LEVEL: Record<Priority, number> = { High: 0, Medium: 1, Low: 2 };

/**
 * The rolling top three (P2-F2). The day's open top-three outcomes come first, in rank order; when
 * fewer than three are open, the next tasks in line move up — the day's other open blocks by
 * priority, then start time. Finished and dropped items leave the three and are listed as done.
 * Ranks themselves are never rewritten: the order the person chose is preserved.
 */
export function rollingTopThree(outcomes: Outcome[], blocks: Block[]): { current: FocusItem[]; done: FocusItem[] } {
  const firstBlockOf = (taskId: string | null | undefined) =>
    taskId
      ? blocks.filter((b) => b.backlogTaskId === taskId).sort((a, b) => toMinutes(a.start) - toMinutes(b.start))
      : [];
  const outcomeItems: FocusItem[] = [...outcomes]
    .sort((a, b) => a.rank - b.rank)
    .map((o) => {
      const sessions = firstBlockOf(o.backlogTaskId);
      return {
        kind: "outcome",
        key: `o${o.rank}`,
        outcome: o,
        block: sessions.find((b) => open(b.status)) ?? sessions[0],
        status: o.status,
      };
    });
  const outcomeTasks = new Set(outcomes.map((o) => o.backlogTaskId).filter((id): id is string => !!id));

  // One entry per task: a task spread over several blocks is one thing to do, shown at its next open session.
  const seen = new Set<string>();
  const blockItems: FocusItem[] = [];
  for (const b of [...blocks].sort((a, b) => toMinutes(a.start) - toMinutes(b.start))) {
    if (b.backlogTaskId && outcomeTasks.has(b.backlogTaskId)) continue;
    const identity = b.backlogTaskId ?? b.id;
    if (seen.has(identity)) continue;
    const sessions = b.backlogTaskId ? firstBlockOf(b.backlogTaskId) : [b];
    const next = sessions.find((s) => open(s.status));
    seen.add(identity);
    blockItems.push({
      kind: "block",
      key: `b${identity}`,
      block: next ?? sessions.at(-1)!,
      status: next ? next.status : sessions.at(-1)!.status,
    });
  }

  const byPriority = (a: FocusItem, b: FocusItem) =>
    a.kind === "block" && b.kind === "block"
      ? LEVEL[a.block.priority] - LEVEL[b.block.priority] || toMinutes(a.block.start) - toMinutes(b.block.start)
      : 0;
  const line = [
    ...outcomeItems.filter((i) => open(i.status)),
    ...blockItems.filter((i) => open(i.status)).sort(byPriority),
  ];
  return {
    current: line.slice(0, 3),
    done: [...outcomeItems, ...blockItems].filter((i) => !open(i.status)),
  };
}
