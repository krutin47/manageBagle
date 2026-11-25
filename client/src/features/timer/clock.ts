import type { Block } from "../../lib/api";

/**
 * Timer arithmetic for the screen. The server says when a run began, by its own clock; the difference
 * between its clock and this device's is remembered, so a device whose clock is off still shows the
 * right elapsed time.
 */
let serverOffsetMs = 0;

export function syncServerClock(serverNowIso: string, receivedAtMs = Date.now()) {
  serverOffsetMs = Date.parse(serverNowIso) - receivedAtMs;
}

export const serverNow = (deviceNowMs = Date.now()) => deviceNowMs + serverOffsetMs;

/** Seconds worked on a block so far: banked runs plus the current one. */
export function elapsedSeconds(block: Pick<Block, "trackedSeconds" | "timerStartedAt">, deviceNowMs = Date.now()): number {
  const running = block.timerStartedAt ? Math.max(0, Math.floor((serverNow(deviceNowMs) - Date.parse(block.timerStartedAt)) / 1000)) : 0;
  return block.trackedSeconds + running;
}

/** When "time's up" is due, in seconds of work. */
export const dueSeconds = (block: Pick<Block, "plannedMinutes" | "extendedMinutes">) => (block.plannedMinutes + block.extendedMinutes) * 60;

/** 75 → "1:15", 3725 → "1:02:05". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}
