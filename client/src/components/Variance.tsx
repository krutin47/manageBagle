import { formatVariance } from "../lib/time";
import { cx } from "./ui";

/** Actual minus planned: "+12m" over, "−5m" under, "—" when nothing was recorded. */
export function Variance({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="muted">—</span>;
  return <span className={cx("variance", minutes > 0 ? "is-over" : "is-under")}>{formatVariance(minutes)}</span>;
}
