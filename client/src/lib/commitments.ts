import type { Block, Commitment as ApiCommitment } from "./api";
import type { Commitment } from "./schedule";
import { parseISODate, toMinutes } from "./time";

const dayGap = (from: string, to: string) => Math.round((parseISODate(to).getTime() - parseISODate(from).getTime()) / 86_400_000);

/**
 * Commitments that touch `date`, in minutes from that date's midnight: today's routines, and the tail
 * of an overnight routine that began the evening before (negative start).
 */
export function commitmentsOn(date: string, all: ApiCommitment[]): (Commitment & { source: ApiCommitment })[] {
  return all
    .map((c) => {
      const start = toMinutes(c.start) + dayGap(date, c.date) * 1440;
      return { start, end: start + c.minutes, policy: c.taskPolicy, areaIds: c.areaIds, title: c.title, source: c };
    })
    .filter((c) => c.end > 0 && c.start < 1440)
    .sort((a, b) => a.start - b.start);
}

/** Existing blocks as busy time, including the recovery breaks they reserve. */
export const busyFromBlocks = (blocks: Block[]): [number, number][] =>
  blocks.map((b) => [toMinutes(b.start) - b.breakBeforeMinutes, Math.min(toMinutes(b.start) + b.plannedMinutes, 1440) + b.breakAfterMinutes]);

/**
 * Fixed time a block runs into (handbook §1: a block over a fixed appointment is rejected or visibly
 * reconciled). Planning refuses these; a block placed by hand is allowed but flagged. A clash is a
 * meeting, a protected routine, or a routine that only takes other focus areas.
 */
export function clashesFor(block: Pick<Block, "start" | "plannedMinutes" | "focusAreaId">, fixed: (Commitment & { source: ApiCommitment })[]): (Commitment & { source: ApiCommitment })[] {
  const start = toMinutes(block.start);
  const end = start + block.plannedMinutes;
  return fixed.filter((c) => c.start < end && c.end > start && (
    c.policy === "NoTasks" || (c.policy === "SelectedAreas" && (block.focusAreaId === null || !c.areaIds.includes(block.focusAreaId)))
  ));
}

/** "Overlaps Lunch", "Overlaps Lunch and Team sync". */
export const clashLabel = (clashes: { title: string }[]) =>
  clashes.length === 0 ? "" : `Overlaps ${clashes.map((c) => c.title).join(" and ")}`;
