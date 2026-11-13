import type { Block } from "../../lib/api";
import { toMinutes } from "../../lib/time";

export interface Placed {
  block: Block;
  startMin: number;
  /** End within this day (a block running past midnight is clipped at 24:00). */
  endMin: number;
  lane: number;
  lanes: number;
  overnight: boolean;
}

/** Lays out one day's blocks side by side where they overlap, like a calendar. */
export function placeBlocks(blocks: Block[]): Placed[] {
  const items = blocks
    .map((block) => {
      const startMin = toMinutes(block.start);
      const rawEnd = startMin + block.plannedMinutes;
      return { block, startMin, endMin: Math.min(rawEnd, 1440), overnight: rawEnd > 1440, lane: 0, lanes: 1 };
    })
    .sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);

  let cluster: Placed[] = [];
  let clusterEnd = -1;
  const flush = () => {
    const lanes = Math.max(0, ...cluster.map((p) => p.lane)) + 1;
    cluster.forEach((p) => (p.lanes = lanes));
    cluster = [];
  };

  for (const item of items) {
    if (item.startMin >= clusterEnd && cluster.length) flush();
    const laneEnds: number[] = [];
    for (const p of cluster) laneEnds[p.lane] = Math.max(laneEnds[p.lane] ?? 0, p.endMin);
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) lane = laneEnds.length;
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length) flush();
  return items;
}
