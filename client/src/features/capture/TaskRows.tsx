import { CalendarDays, Clock, Coffee, Gauge, MapPin, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import type { ReactNode } from "react";
import { DateChip, OptionChip, Tip } from "../../components/OptionChip";
import { cx, IconButton, Segmented } from "../../components/ui";
import type { Area, Priority, WorkMode } from "../../lib/api";
import { modeLabel, PRIORITIES, WORK_MODES } from "../../lib/labels";
import { addDays, formatDate, formatDuration, todayISO } from "../../lib/time";
import { dueQuickPicks, sortRows, topicGroups, withWorkMode, type Row, type SortMode } from "./rows";

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];
export const SORTS: { value: SortMode; label: string }[] = [
  { value: "written", label: "As written" },
  { value: "topic", label: "Topic" },
  { value: "impact", label: "Impact" },
  { value: "due", label: "Due date" },
];
const OUTSIDE_TIP = "Outside work — errands, travel, appointments. Adds a buffer because the physical world runs late.";

export function dueLabel(due: string, today = todayISO()): string {
  if (due < today) return "Overdue";
  if (due === today) return "Due today";
  if (due === addDays(today, 1)) return "Due tomorrow";
  return `Due ${formatDate(due, "medium")}`;
}

interface Props {
  rows: Row[];
  setRows: (update: (rows: Row[]) => Row[]) => void;
  areas: Area[];
  sort: SortMode;
  onSort: (mode: SortMode) => void;
  /** Extra text under a row, e.g. "already in your backlog". */
  note?: (row: Row) => ReactNode;
}

/**
 * The list of tasks being written, each with the same row of option chips (P2-A3–A7). Shared by the
 * brain dump (capture) and Plan my day (tasks typed in while planning).
 */
export function TaskRows({ rows, setRows, areas, sort, onSort, note }: Props) {
  const today = todayISO();
  const patch = (key: string, p: Partial<Row>) =>
    setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));
  const view = sortRows(rows, sort, areas);
  const areaOf = (id: string | null) => areas.find((a) => a.id === id);
  const areaOptions = [
    { value: "", label: "No focus area", area: "none" },
    ...areas.map((a) => ({ value: a.id, label: a.name, area: a.color as string })),
  ];

  return (
    <>
      {rows.length > 1 && (
        <div className="dump-sort">
          <span className="field-label">Sort by</span>
          <Segmented size="sm" label="Sort the list by" value={sort} onChange={onSort} options={SORTS} />
          <span
            className="sr-only"
            aria-live="polite"
          >{`Sorted ${SORTS.find((x) => x.value === sort)!.label.toLowerCase()}`}</span>
        </div>
      )}
      <ul className="dump-rows">
        <AnimatePresence initial={false}>
          {(sort === "topic" ? topicGroups(view) : [{ focusAreaId: undefined, rows: view }]).flatMap((group) => [
            ...(group.focusAreaId !== undefined
              ? [
                  <motion.li
                    layout="position"
                    key={`h-${group.focusAreaId ?? "none"}`}
                    className="dump-group"
                    data-area={areaOf(group.focusAreaId)?.color ?? "none"}
                  >
                    <span className="area-dot" aria-hidden />
                    {areaOf(group.focusAreaId)?.name ?? "No focus area"}
                    <span className="dump-group-count">
                      {group.rows.length} · {formatDuration(group.rows.reduce((t, r) => t + r.minutes, 0))}
                    </span>
                  </motion.li>,
                ]
              : []),
            ...group.rows.map((r) => {
              const area = areaOf(r.focusAreaId);
              const late = r.dueDate !== null && r.dueDate <= today;
              const extra = note?.(r);
              return (
                <motion.li
                  key={r.key}
                  layout="position"
                  initial={{ opacity: 0, y: -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.18 }}
                  className="dump-row"
                  data-area={area?.color ?? "none"}
                >
                  <span className="agenda-bar" aria-hidden />
                  <input
                    className="cell-input plan-title"
                    aria-label="Task"
                    maxLength={200}
                    value={r.title}
                    onChange={(e) => patch(r.key, { title: e.target.value })}
                  />
                  <IconButton
                    size="sm"
                    label={`Remove ${r.title}`}
                    onClick={() => setRows((list) => list.filter((x) => x.key !== r.key))}
                  >
                    <X size={15} />
                  </IconButton>
                  {r.taskId === null ? (
                    <div className="dump-chips" role="group" aria-label={`Options for ${r.title}`}>
                      <OptionChip
                        label="Length"
                        icon={<Clock size={13} aria-hidden />}
                        value={String(r.minutes)}
                        options={[...new Set([...LENGTHS, r.minutes])]
                          .sort((x, y) => x - y)
                          .map((m) => ({ value: String(m), label: formatDuration(m) }))}
                        onChange={(v) => patch(r.key, { minutes: Number(v), minutesChosen: true })}
                      />
                      <OptionChip
                        label="Kind of work"
                        icon={<Zap size={13} aria-hidden />}
                        value={r.workMode}
                        options={WORK_MODES.map((m) => ({ value: m, label: modeLabel[m] }))}
                        onChange={(v) =>
                          setRows((list) => list.map((x) => (x.key === r.key ? withWorkMode(x, v as WorkMode) : x)))
                        }
                      />
                      <OptionChip
                        label="Focus area"
                        area={area?.color ?? "none"}
                        value={r.focusAreaId ?? ""}
                        options={areaOptions}
                        onChange={(v) => patch(r.key, { focusAreaId: v || null })}
                      />
                      <OptionChip
                        label="Outcome impact"
                        icon={<Gauge size={13} aria-hidden />}
                        strong={r.impact === "High"}
                        value={r.impact}
                        options={PRIORITIES.map((v) => ({ value: v, label: `${v} impact` }))}
                        onChange={(v) => patch(r.key, { impact: v as Priority })}
                      />
                      <OptionChip
                        label="Recovery break"
                        icon={<Coffee size={13} aria-hidden />}
                        value={r.breakMinutes === null ? "area" : String(r.breakMinutes)}
                        options={[
                          {
                            value: "area",
                            label:
                              area && area.breakMinutes > 0
                                ? `${formatDuration(area.breakMinutes)} break (area)`
                                : "No break",
                          },
                          ...[0, 5, 10, 15, 20, 30].map((m) => ({
                            value: String(m),
                            label: m === 0 ? "No break" : `${formatDuration(m)} break`,
                          })),
                        ].filter((o, i, all) => all.findIndex((x) => x.label === o.label) === i)}
                        onChange={(v) => patch(r.key, { breakMinutes: v === "area" ? null : Number(v) })}
                      />
                      <DateChip
                        label="Due date"
                        icon={<CalendarDays size={13} aria-hidden />}
                        value={r.dueDate}
                        warn={late}
                        display={r.dueDate ? dueLabel(r.dueDate, today) : "No due date"}
                        quickPicks={dueQuickPicks(today)}
                        onChange={(v) => patch(r.key, { dueDate: v, priorityOverride: null })}
                      />
                      <Tip content={OUTSIDE_TIP}>
                        <button
                          type="button"
                          className={cx("opt-chip opt-icon", r.isOutside && "is-on")}
                          aria-pressed={r.isOutside}
                          aria-label="Outside work"
                          onClick={() => patch(r.key, { isOutside: !r.isOutside })}
                        >
                          <MapPin size={15} aria-hidden />
                        </button>
                      </Tip>
                    </div>
                  ) : (
                    <p className="dump-from-backlog">
                      From your backlog · {area?.name ?? "No focus area"} · {formatDuration(r.minutes)} ·{" "}
                      {modeLabel[r.workMode]}
                      {r.dueDate && (
                        <>
                          {" "}
                          · <span className={cx(late && "due is-late")}>{dueLabel(r.dueDate, today)}</span>
                        </>
                      )}
                    </p>
                  )}
                  {extra && <p className="dump-note">{extra}</p>}
                </motion.li>
              );
            }),
          ])}
        </AnimatePresence>
      </ul>
    </>
  );
}
