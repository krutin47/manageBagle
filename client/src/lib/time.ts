/** Dates travel as "YYYY-MM-DD" and times as "HH:mm" — always the user's local wall clock, never UTC. */

export const pad = (n: number) => String(n).padStart(2, "0");

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseISODate(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const todayISO = () => toISODate(new Date());

export function addDays(iso: string, days: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

/** Monday of the week containing the date. */
export function weekStart(iso: string): string {
  const d = parseISODate(iso);
  return addDays(iso, -((d.getDay() + 6) % 7));
}

export const weekDays = (start: string) => Array.from({ length: 7 }, (_, i) => addDays(start, i));

export const isValidISODate = (s: string | null | undefined): s is string =>
  !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && toISODate(parseISODate(s)) === s;

export function formatDate(iso: string, style: "long" | "medium" | "short" | "weekday" | "day" | "weekdayShort" = "medium"): string {
  const d = parseISODate(iso);
  const options: Record<string, Intl.DateTimeFormatOptions> = {
    long: { weekday: "long", day: "numeric", month: "long" },
    medium: { weekday: "short", day: "numeric", month: "short" },
    short: { day: "numeric", month: "short" },
    weekday: { weekday: "long" },
    weekdayShort: { weekday: "short" },
    day: { day: "numeric" },
  };
  return new Intl.DateTimeFormat(undefined, options[style]).format(d);
}

export function formatWeekRange(start: string): string {
  // formatRange collapses the shared parts for the locale: "Nov 9 – 15, 2026", "30 Nov – 6 Dec 2026".
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" }).formatRange(parseISODate(start), parseISODate(addDays(start, 6)));
}

/** "09:30" or "09:30:00" → 570 */
export function toMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
}

export function fromMinutes(total: number): string {
  const m = ((Math.round(total) % 1440) + 1440) % 1440;
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
}

export const trimSeconds = (time: string) => time.slice(0, 5);

/** Length of a block; an end before the start means it runs past midnight. */
export function plannedMinutes(start: string, end: string): number {
  return (((toMinutes(end) - toMinutes(start)) % 1440) + 1440) % 1440;
}

export const snap = (minutes: number, step = 5) => Math.round(minutes / step) * step;

/** 95 → "1h 35m", 60 → "1h", 45 → "45m" */
export function formatDuration(minutes: number): string {
  const sign = minutes < 0 ? "−" : "";
  const abs = Math.abs(Math.round(minutes));
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  if (h === 0) return `${sign}${m}m`;
  return m === 0 ? `${sign}${h}h` : `${sign}${h}h ${m}m`;
}

/** 135 → "2.3" (hours, one decimal, like the workbook's dashboard) */
export function formatHours(minutes: number): string {
  const h = minutes / 60;
  return h === 0 ? "0" : h.toFixed(1).replace(/\.0$/, "");
}

export function formatTime(time: string): string {
  const [h, m] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date(2000, 0, 1, h, m));
}

export const formatVariance = (minutes: number) => (minutes > 0 ? `+${formatDuration(minutes)}` : minutes === 0 ? "on time" : formatDuration(minutes));
