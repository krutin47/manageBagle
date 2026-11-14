import { ArrowLeft, ArrowRight, Check, CornerDownLeft, Inbox, MapPin, Plus, Sparkles, Wand2, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useToast } from "../../components/toast";
import { Button, cx, Dialog, ErrorNote, IconButton, Segmented, Select } from "../../components/ui";
import { errorMessage, type Area, type Block, type PlanItem, type Priority, type Task, type WorkMode } from "../../lib/api";
import { modeLabel, PRIORITIES, WORK_MODES } from "../../lib/labels";
import { useBacklog, usePlanDay } from "../../lib/queries";
import { proposeSchedule } from "../../lib/schedule";
import { addDays, formatDate, formatDuration, fromMinutes, snap, todayISO, toMinutes } from "../../lib/time";

interface Row {
  key: string;
  taskId: string | null;
  title: string;
  minutes: number;
  focusAreaId: string | null;
  workMode: WorkMode;
  isOutside: boolean;
  priority: Priority;
  impact: Priority;
  dueDate: string | null;
  top: number | null;
}

type SortKey = "written" | "topic" | "impact" | "due";

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];
const STEPS = ["Brain dump", "Pick your top three", "Fit it into the day"];
const LEVEL = { High: 0, Medium: 1, Low: 2 };

const fromTask = (t: Task): Row => ({
  key: t.id, taskId: t.id, title: t.title, minutes: t.estimatedMinutes ?? 30, focusAreaId: t.focusAreaId, workMode: t.workMode,
  isOutside: t.isOutside, priority: t.priority, impact: t.impact, dueDate: t.dueDate, top: null,
});

/** Higher is more worth doing today: impact counts most, then priority, then how soon it is due. */
export function valueScore(row: Pick<Row, "impact" | "priority" | "dueDate">, today: string): number {
  const due = row.dueDate === null ? 0 : row.dueDate <= today ? 3 : row.dueDate <= addDays(today, 2) ? 2 : row.dueDate <= addDays(today, 7) ? 1 : 0;
  return (2 - LEVEL[row.impact]) * 5 + (2 - LEVEL[row.priority]) * 2 + due;
}

export function dueLabel(due: string, today = todayISO()): string {
  if (due < today) return "Overdue";
  if (due === today) return "Due today";
  if (due === addDays(today, 1)) return "Due tomorrow";
  return `Due ${formatDate(due, "medium")}`;
}

interface Props {
  open: boolean;
  date: string;
  areas: Area[];
  blocks: Block[];
  takenRanks: number[];
  /** Tasks to start the dump with, e.g. one picked from "Due soon". */
  seed?: Task[];
  onClose: () => void;
}

export function BrainDumpDialog({ open, date, areas, blocks, takenRanks, seed, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={date === todayISO() ? "Brain dump" : `Brain dump for ${formatDate(date, "long")}`} description="Empty your head. Then pick the three that matter most and let the day take shape." width="xl">
      {open && <PlanFlow date={date} areas={areas} blocks={blocks} takenRanks={takenRanks} seed={seed} onClose={onClose} />}
    </Dialog>
  );
}

function defaultStart(date: string, blocks: Block[]) {
  if (date === todayISO()) {
    const now = new Date();
    return Math.min(snap(now.getHours() * 60 + now.getMinutes() + 10, 15), 23 * 60);
  }
  return blocks.length ? Math.min(...blocks.map((b) => toMinutes(b.start)), 9 * 60) : 9 * 60;
}

function PlanFlow({ date, areas, blocks, takenRanks, seed, onClose }: Omit<Props, "open">) {
  const toast = useToast();
  const backlog = useBacklog();
  const plan = usePlanDay(date);
  const [step, setStep] = useState(0);
  const [rows, setRows] = useState<Row[]>(() => (seed ?? []).map(fromTask));
  const [batch, setBatch] = useState(true);
  const [text, setText] = useState("");
  const [from, setFrom] = useState(() => fromMinutes(defaultStart(date, blocks)));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);

  // Ranks already held by outcomes that are not part of this plan stay theirs.
  const freeRanks = [1, 2, 3].filter((r) => !takenRanks.includes(r));
  const patch = (key: string, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const add = (e: FormEvent) => {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    const last = rows.at(-1);
    // A new line inherits topic and kind of work from the one above: people dump related things in runs.
    setRows([...rows, { key: `n${nextKey.current++}`, taskId: null, title, minutes: 30, focusAreaId: last?.focusAreaId ?? null, workMode: last?.workMode ?? "ShallowWork", isOutside: false, priority: "Medium", impact: "Medium", dueDate: null, top: null }]);
    setText("");
    input.current?.focus();
  };

  const addTask = (t: Task) => setRows((list) => [...list, fromTask(t)]);

  // Suggestions: open, unbooked backlog tasks — what is due soonest first, then what is worth most.
  const today = todayISO();
  const suggestions = (backlog.data ?? [])
    .filter((t) => t.status !== "Done" && t.status !== "Skipped" && !t.scheduledDate && !rows.some((r) => r.taskId === t.id))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || valueScore(b, today) - valueScore(a, today));

  const areaOrder = (id: string | null) => (id === null ? 999 : areas.findIndex((a) => a.id === id));
  const sortRows = (key: SortKey) =>
    setRows((list) => {
      const original = [...list].sort((a, b) => list.indexOf(a) - list.indexOf(b));
      if (key === "topic") return original.sort((a, b) => areaOrder(a.focusAreaId) - areaOrder(b.focusAreaId) || WORK_MODES.indexOf(a.workMode) - WORK_MODES.indexOf(b.workMode));
      if (key === "impact") return original.sort((a, b) => valueScore(b, today) - valueScore(a, today));
      if (key === "due") return original.sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
      return original;
    });

  const suggestTop = () =>
    setRows((list) => {
      const best = [...list].sort((a, b) => valueScore(b, today) - valueScore(a, today)).slice(0, freeRanks.length);
      return list.map((r) => ({ ...r, top: best.includes(r) ? freeRanks[best.indexOf(r)] : null }));
    });

  const toggleTop = (key: string) =>
    setRows((list) => {
      const row = list.find((r) => r.key === key)!;
      if (row.top !== null) return list.map((r) => (r.key === key ? { ...r, top: null } : r));
      const free = freeRanks.find((rank) => !list.some((r) => r.top === rank));
      return free === undefined ? list : list.map((r) => (r.key === key ? { ...r, top: free } : r));
    });

  const busy = useMemo(() => blocks.map((b): [number, number] => [toMinutes(b.start), Math.min(toMinutes(b.start) + b.plannedMinutes, 1440)]), [blocks]);
  const proposal = useMemo(() => proposeSchedule(rows.map((r) => ({ ...r, topic: r.focusAreaId })), busy, toMinutes(from || "09:00"), batch), [rows, busy, from, batch]);
  const ordered = useMemo(() => [...rows].sort((a, b) => (proposal.slots.get(a.key)?.start ?? 9999) - (proposal.slots.get(b.key)?.start ?? 9999)), [rows, proposal]);

  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const lastEnd = Math.max(0, ...[...proposal.slots.values()].map((s) => s.end));
  const picked = rows.filter((r) => r.top !== null).length;

  const goNext = () => {
    // With three tasks or fewer there is nothing to choose between: they are the top three.
    if (step === 0 && picked === 0 && rows.length <= freeRanks.length) {
      setRows(rows.map((r, i) => ({ ...r, top: freeRanks[i] })));
    }
    setStep(step + 1);
  };

  const commit = async (onlyTop: boolean) => {
    setError(null);
    const items: PlanItem[] = rows.map((r) => {
      const slot = onlyTop && r.top === null ? undefined : proposal.slots.get(r.key);
      return {
        taskId: r.taskId, title: r.title, estimatedMinutes: r.minutes, focusAreaId: r.focusAreaId, workMode: r.workMode, isOutside: r.isOutside,
        priority: r.priority, impact: r.impact, dueDate: r.dueDate, topRank: r.top, start: slot ? fromMinutes(slot.start) : null, end: slot ? fromMinutes(slot.end) : null,
      };
    });
    try {
      const result = await plan.mutateAsync(items);
      toast.success(
        result.leftInBacklog > 0
          ? `${result.blocksBooked} booked for ${date === todayISO() ? "today" : formatDate(date, "medium")} · ${result.leftInBacklog} kept in your backlog`
          : `${result.blocksBooked} block${result.blocksBooked === 1 ? "" : "s"} booked. Your day is planned.`,
      );
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <>
      <ol className="stepper" aria-label="Steps">
        {STEPS.map((label, i) => (
          <li key={label} className={cx(i === step && "is-current", i < step && "is-done")} aria-current={i === step ? "step" : undefined}>
            <span className="stepper-dot">{i < step ? <Check size={12} strokeWidth={3.5} aria-hidden /> : i + 1}</span>
            <span className="stepper-label">{label}</span>
          </li>
        ))}
      </ol>

      <div className="dialog-body plan-body">
        {error && <ErrorNote>{error}</ErrorNote>}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16, transition: { duration: 0.1 } }} transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}>
            {step === 0 && (
              <div className="plan-step">
                <form className="capture plan-capture" onSubmit={add}>
                  <Plus size={18} aria-hidden />
                  <input ref={input} autoFocus aria-label="What needs doing?" placeholder="What needs doing? Type it and press Enter…" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
                  <kbd aria-hidden><CornerDownLeft size={12} /> Enter</kbd>
                </form>

                {rows.length === 0 ? (
                  <p className="plan-hint">Write everything down first — one line each, no sorting, no judging. You will pick your top three next.</p>
                ) : (
                  <>
                    {rows.length > 2 && (
                      <div className="dump-sort">
                        <span className="field-label">Sort</span>
                        <div className="dump-sort-btns" role="group" aria-label="Sort the list">
                          <button type="button" className="chip-btn" onClick={() => sortRows("topic")} title="Group by focus area so you switch context less">By topic</button>
                          <button type="button" className="chip-btn" onClick={() => sortRows("impact")}>By impact</button>
                          <button type="button" className="chip-btn" onClick={() => sortRows("due")}>By due date</button>
                        </div>
                      </div>
                    )}
                    <ul className="dump-rows">
                      <li className="dump-head" aria-hidden>
                        <span /><span>Task</span><span>Duration</span><span>Priority</span><span>Impact</span><span>Due</span><span />
                      </li>
                      <AnimatePresence initial={false}>
                        {rows.map((r) => (
                          <motion.li key={r.key} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} className="dump-row" data-area={areas.find((a) => a.id === r.focusAreaId)?.color ?? "none"}>
                            <span className="agenda-bar" aria-hidden />
                            <input className="cell-input plan-title" aria-label="Task" maxLength={200} value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} />
                            <Select data-label="Duration" className="plan-sel" aria-label={`How long will “${r.title}” take?`} value={r.minutes} onChange={(e) => patch(r.key, { minutes: Number(e.target.value) })}>
                              {[...new Set([...LENGTHS, r.minutes])].sort((a, b) => a - b).map((m) => <option key={m} value={m}>{formatDuration(m)}</option>)}
                            </Select>
                            <Select data-label="Priority" className="plan-sel" aria-label={`Priority of “${r.title}”`} value={r.priority} onChange={(e) => patch(r.key, { priority: e.target.value as Priority })}>
                              {PRIORITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                            </Select>
                            <Select data-label="Impact" className={cx("plan-sel", r.impact === "High" && "is-high")} aria-label={`Outcome impact of “${r.title}”`} value={r.impact} onChange={(e) => patch(r.key, { impact: e.target.value as Priority })}>
                              {PRIORITIES.map((v) => <option key={v} value={v}>{v}</option>)}
                            </Select>
                            <input type="date" className="input plan-due" aria-label={`Due date of “${r.title}”`} value={r.dueDate ?? ""} onChange={(e) => patch(r.key, { dueDate: e.target.value || null })} />
                            <IconButton size="sm" label={`Remove ${r.title}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><X size={15} /></IconButton>
                            <div className="dump-more">
                              <Select className="plan-sel" aria-label={`Kind of work for “${r.title}”`} value={r.workMode} onChange={(e) => patch(r.key, { workMode: e.target.value as WorkMode })}>
                                {WORK_MODES.map((m) => <option key={m} value={m}>{modeLabel[m]}</option>)}
                              </Select>
                              <Select className="plan-sel" aria-label={`Focus area for “${r.title}”`} value={r.focusAreaId ?? ""} onChange={(e) => patch(r.key, { focusAreaId: e.target.value || null })}>
                                <option value="">No focus area</option>
                                {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                              </Select>
                              <button type="button" className={cx("outside-chip", r.isOutside && "is-on")} aria-pressed={r.isOutside} title="Outside work: errands, travel, appointments. A buffer is added because it may run long." onClick={() => patch(r.key, { isOutside: !r.isOutside })}>
                                <MapPin size={14} aria-hidden /> Outside work
                              </button>
                            </div>
                          </motion.li>
                        ))}
                      </AnimatePresence>
                    </ul>
                  </>
                )}

                {suggestions.length > 0 && (
                  <div className="plan-suggest">
                    <span className="field-label"><Inbox size={14} aria-hidden /> Suggested from your backlog — due soonest first</span>
                    <div className="plan-suggest-list">
                      {suggestions.slice(0, 8).map((t) => (
                        <button key={t.id} type="button" className="chip-btn plan-suggest-chip" onClick={() => addTask(t)}>
                          <Plus size={12} aria-hidden /> {t.title}
                          {t.dueDate && <em className={cx(t.dueDate <= today && "is-late")}>{dueLabel(t.dueDate, today)}</em>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="plan-step">
                <p className="plan-hint">
                  {freeRanks.length === 0
                    ? "Your top three for this day are already chosen. Everything here will be planned around them."
                    : `If only ${freeRanks.length === 1 ? "one thing" : `${freeRanks.length === 2 ? "two" : "three"} things`} got done, which would move you furthest? Tap in order of importance.`}
                </p>
                {freeRanks.length > 0 && rows.length > freeRanks.length && (
                  <div>
                    <Button size="sm" icon={<Wand2 size={15} aria-hidden />} onClick={suggestTop}>Suggest for me</Button>
                    <span className="plan-hint plan-hint-inline">Ranks by impact, then priority, then what is due soonest.</span>
                  </div>
                )}
                <ul className="plan-pick">
                  {[...rows].sort((a, b) => valueScore(b, today) - valueScore(a, today)).map((r) => {
                    const disabled = r.top === null && picked >= freeRanks.length;
                    return (
                      <li key={r.key}>
                        <button type="button" className={cx("pick-row", r.top !== null && "is-top")} aria-pressed={r.top !== null} disabled={disabled} onClick={() => toggleTop(r.key)}>
                          <span className="pick-rank">{r.top ?? ""}</span>
                          <span className="pick-title">{r.title}</span>
                          <span className="pick-meta">
                            <span className={cx("impact-tag", `is-${r.impact.toLowerCase()}`)}>{r.impact} impact</span>
                            {r.priority} priority · {formatDuration(r.minutes)}{r.dueDate && <> · <span className={cx(r.dueDate <= today && "due is-late")}>{dueLabel(r.dueDate, today)}</span></>}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}

            {step === 2 && (
              <div className="plan-step">
                <div className="plan-fit-head">
                  <p className="plan-question">
                    <Sparkles size={18} aria-hidden /> Shall I add {rows.length === 1 ? "this" : `all ${rows.length}`} to {date === todayISO() ? "today" : formatDate(date, "weekday")}?
                  </p>
                  <div className="plan-fit-controls">
                    <Segmented size="sm" label="Order" value={batch ? "batch" : "plain"} onChange={(v) => setBatch(v === "batch")} options={[{ value: "batch", label: "Batch similar work" }, { value: "plain", label: "As written" }]} />
                    <label className="plan-from">
                      Start from
                      <input type="time" className="input" step={300} value={from} onChange={(e) => setFrom(e.target.value)} />
                    </label>
                  </div>
                </div>
                <ul className="plan-fit">
                  {ordered.map((r) => {
                    const slot = proposal.slots.get(r.key);
                    return (
                      <motion.li key={r.key} layout="position" className={cx("fit-row", !slot && "is-out")} data-area={areas.find((a) => a.id === r.focusAreaId)?.color ?? "none"}>
                        <span className="fit-time">{slot ? <><strong>{fromMinutes(slot.start)}</strong><span>{fromMinutes(slot.end)}</span></> : <span>—</span>}</span>
                        <span className="agenda-bar" aria-hidden />
                        <span className="fit-main">
                          <span className="fit-title">{r.top !== null && <b className="rank-badge">{r.top}</b>}{r.title}</span>
                          <span className="fit-meta">
                            {slot ? <>{areas.find((a) => a.id === r.focusAreaId)?.name ?? "No focus area"} · {formatDuration(r.minutes)} · {modeLabel[r.workMode]}{slot.buffer > 0 && <span className="fit-buffer"> · +{formatDuration(slot.buffer)} buffer for outside work</span>}</> : "No room left today — it will wait in your backlog"}
                          </span>
                        </span>
                      </motion.li>
                    );
                  })}
                </ul>
                <p className="plan-hint">{batch ? "After your top three, tasks in the same focus area are kept together so you switch context less. " : ""}{blocks.length > 0 ? `Planned around the ${blocks.length} block${blocks.length === 1 ? "" : "s"} already in this day. ` : ""}You can drag anything afterwards in the Planner.</p>
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      <footer className="dialog-foot plan-foot">
        <span className="plan-total push-left" aria-live="polite">
          {rows.length === 0 ? "Nothing yet" : step === 2 && proposal.slots.size > 0
            ? <><strong>{proposal.slots.size}</strong> of {rows.length} fit · done by <strong>{fromMinutes(lastEnd)}</strong></>
            : <><strong>{rows.length}</strong> task{rows.length === 1 ? "" : "s"} · <strong>{formatDuration(total)}</strong></>}
        </span>
        {step > 0 ? <Button icon={<ArrowLeft size={16} aria-hidden />} onClick={() => setStep(step - 1)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
        {step < 2 && (
          <Button variant="primary" disabled={rows.length === 0 || rows.some((r) => !r.title.trim())} onClick={goNext}>
            {step === 0 ? "Next: top three" : picked === 0 && freeRanks.length > 0 ? "Skip" : "Next: fit into the day"} <ArrowRight size={16} aria-hidden />
          </Button>
        )}
        {step === 2 && (
          <>
            {picked > 0 && picked < rows.length && <Button loading={plan.isPending} onClick={() => commit(true)}>Just the top {picked === 1 ? "one" : picked === 2 ? "two" : "three"}</Button>}
            <Button variant="primary" loading={plan.isPending} disabled={proposal.slots.size === 0} onClick={() => commit(false)}>
              {proposal.unplaced.length > 0 ? `Add the ${proposal.slots.size} that fit` : rows.length === 1 ? "Add to the day" : "Yes, add them all"}
            </Button>
          </>
        )}
      </footer>
    </>
  );
}
