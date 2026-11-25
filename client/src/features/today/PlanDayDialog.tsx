import { ArrowLeft, ArrowRight, CalendarClock, Check, CornerDownLeft, Gauge, Inbox, Lock, Plus, Sparkles, Wand2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useToast } from "../../components/toast";
import { Button, cx, Dialog, ErrorNote, Segmented } from "../../components/ui";
import { errorMessage, type Area, type Block, type PlanItem, type Task } from "../../lib/api";
import { modeLabel } from "../../lib/labels";
import { busyFromBlocks, commitmentsOn } from "../../lib/commitments";
import { useBacklog, useCommitments, usePlanDay, usePreferences } from "../../lib/queries";
import { proposeSchedule } from "../../lib/schedule";
import { formatDate, formatDuration, fromMinutes, nowMinutes, snap, todayISO, toMinutes } from "../../lib/time";
import { dueLabel, TaskRows } from "../capture/TaskRows";
import { newRow, planSuggestions, priorityOf, rowFromTask, valueScore, type Row, type SortMode } from "./brainDump";

export { dueLabel, valueScore };

const STEPS = ["Choose from your backlog", "Pick your top three", "Fit it into the day"];


interface Props {
  open: boolean;
  date: string;
  areas: Area[];
  blocks: Block[];
  takenRanks: number[];
  /** Tasks already chosen when it opens, e.g. one picked from "Due soon". */
  seed?: Task[];
  onClose: () => void;
}

/**
 * Plan my day (P2-E2): choose from the backlog, pick the top three, fit them around routines and
 * meetings. Separate from the brain dump, which only captures.
 */
export function PlanDayDialog({ open, date, areas, blocks, takenRanks, seed, onClose }: Props) {
  return (
    <Dialog open={open} onClose={onClose} title={date === todayISO() ? "Plan my day" : `Plan ${formatDate(date, "long")}`} description="Choose from your backlog, pick the three that matter most, and fit them around your routines and meetings." width="xl">
      {open && <PlanFlow date={date} areas={areas} blocks={blocks} takenRanks={takenRanks} seed={seed} onClose={onClose} />}
    </Dialog>
  );
}

function defaultStart(date: string, blocks: Block[]) {
  if (date === todayISO()) return Math.min(snap(nowMinutes() + 10, 15), 23 * 60);
  return blocks.length ? Math.min(...blocks.map((b) => toMinutes(b.start)), 9 * 60) : 9 * 60;
}

function PlanFlow({ date, areas, blocks, takenRanks, seed, onClose }: Omit<Props, "open">) {
  const toast = useToast();
  const backlog = useBacklog();
  const plan = usePlanDay(date);
  const [step, setStep] = useState(0);
  const [rows, setRows] = useState<Row[]>(() => (seed ?? []).map(rowFromTask));
  const [sort, setSort] = useState<SortMode>("written");
  const [showAll, setShowAll] = useState(false);
  const [batch, setBatch] = useState(true);
  const [text, setText] = useState("");
  const [from, setFrom] = useState(() => fromMinutes(defaultStart(date, blocks)));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const sent = useRef({ fingerprint: "", key: "" });

  // Ranks already held by outcomes that are not part of this plan stay theirs.
  const freeRanks = [1, 2, 3].filter((r) => !takenRanks.includes(r));

  const add = (e: FormEvent) => {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    setRows((list) => [...list, newRow(crypto.randomUUID(), title, list.filter((r) => r.taskId === null).at(-1))]);
    setText("");
    input.current?.focus();
  };

  const toggleTask = (t: Task) => setRows((list) => (list.some((r) => r.taskId === t.id) ? list.filter((r) => r.taskId !== t.id) : [...list, rowFromTask(t)]));

  // What the backlog offers: due soon, then high impact, then the rest (P2-E2). Seeded tasks stay listed even if booked elsewhere.
  const today = todayISO();
  const groups = useMemo(() => planSuggestions(backlog.data ?? [], today), [backlog.data, today]);
  const areaOf = (id: string | null) => areas.find((a) => a.id === id);

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

  // What the day already holds: blocks (with their breaks), routines, and the day window (P2-C3).
  const commitmentsQuery = useCommitments(date);
  const preferences = usePreferences();
  const fixed = useMemo(() => commitmentsOn(date, commitmentsQuery.data ?? []), [date, commitmentsQuery.data]);
  const breakOf = (r: Row) => {
    const area = areaOf(r.focusAreaId);
    return { breakMinutes: r.breakMinutes ?? area?.breakMinutes ?? 0, breakPlacement: area?.breakPlacement ?? "After" };
  };
  const proposal = proposeSchedule(rows.map((r) => ({ ...r, topic: r.focusAreaId, ...breakOf(r) })), {
    from: toMinutes(from || "09:00"),
    busy: busyFromBlocks(blocks),
    commitments: fixed,
    dayStart: toMinutes(preferences.data?.dayStart ?? "00:00"),
    dayEnd: toMinutes(preferences.data?.dayEnd ?? "23:55"),
    batch,
  });
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
        priority: priorityOf(r, today), impact: r.impact, dueDate: r.dueDate, topRank: r.top, start: slot ? fromMinutes(slot.start) : null, end: slot ? fromMinutes(slot.end) : null,
        breakBeforeMinutes: slot?.breakBefore ?? 0, breakAfterMinutes: slot?.breakAfter ?? 0, breakMinutes: r.breakMinutes,
      };
    });
    try {
      // Same plan, same key: a double click or a retry is saved once. A changed plan gets a new key.
      const fingerprint = JSON.stringify(items);
      if (sent.current.fingerprint !== fingerprint) sent.current = { fingerprint, key: crypto.randomUUID() };
      const result = await plan.mutateAsync({ items, idempotencyKey: sent.current.key });
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
                {groups.length === 0 && (
                  <p className="plan-hint">Nothing open and unbooked in your backlog. Type what this day needs below{rows.length ? "" : ", or empty your head with Brain dump first"}.</p>
                )}
                {groups.map((g) => {
                  const shown = g.id === "rest" && !showAll ? g.tasks.slice(0, 6) : g.tasks;
                  return (
                    <section key={g.id} className="choose-group" aria-labelledby={`choose-${g.id}`}>
                      <h3 id={`choose-${g.id}`} className="field-label">{g.id === "due" ? <CalendarClock size={14} aria-hidden /> : g.id === "impact" ? <Gauge size={14} aria-hidden /> : <Inbox size={14} aria-hidden />} {g.label}</h3>
                      <ul className="choose-list">
                        {shown.map((t) => {
                          const chosen = rows.some((r) => r.taskId === t.id);
                          const area = areaOf(t.focusAreaId);
                          return (
                            <li key={t.id}>
                              <button type="button" className={cx("choose-row", chosen && "is-on")} aria-pressed={chosen} data-area={area?.color ?? "none"} onClick={() => toggleTask(t)}>
                                <span className="choose-check" aria-hidden>{chosen && <Check size={14} strokeWidth={3} />}</span>
                                <span className="choose-title">{t.title}</span>
                                <span className="choose-meta">
                                  {t.impact === "High" && <span className="impact-tag is-high">High impact</span>}
                                  {area?.name ?? "No focus area"}{t.estimatedMinutes !== null && <> · {formatDuration(t.estimatedMinutes)}</>}
                                  {t.status === "InProgress" && <> · started</>}
                                  {t.dueDate && <> · <span className={cx(t.dueDate <= today && "due is-late")}>{dueLabel(t.dueDate, today)}</span></>}
                                </span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                      {g.id === "rest" && g.tasks.length > 6 && (
                        <button type="button" className="link-btn" onClick={() => setShowAll(!showAll)}>{showAll ? "Show fewer" : `Show all ${g.tasks.length}`}</button>
                      )}
                    </section>
                  );
                })}

                <section className="plan-suggest" aria-labelledby="plan-new">
                  <h3 id="plan-new" className="field-label"><Plus size={14} aria-hidden /> Something new for {date === today ? "today" : "this day"}?</h3>
                  <form className="capture plan-capture" onSubmit={add}>
                    <Plus size={18} aria-hidden />
                    <input ref={input} aria-label="Add a new task to this plan" placeholder="Type a task and press Enter…" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
                    <kbd aria-hidden><CornerDownLeft size={12} /> Enter</kbd>
                  </form>
                  {rows.some((r) => r.taskId === null) && (
                    <TaskRows rows={rows.filter((r) => r.taskId === null)} setRows={setRows} areas={areas} sort={sort} onSort={setSort} />
                  )}
                </section>
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
                    <span className="plan-hint plan-hint-inline">Ranks by impact first, then by how soon it is due.</span>
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
                            {formatDuration(r.minutes)} · {modeLabel[r.workMode]}{r.dueDate && <> · <span className={cx(r.dueDate <= today && "due is-late")}>{dueLabel(r.dueDate, today)}</span></>}
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
                  {fixed.filter((c) => c.policy === "NoTasks" && c.end > toMinutes(from || "00:00")).map((c) => (
                    <li key={`r-${c.source.sourceId}-${c.start}`} className={cx("fit-row is-routine", c.source.kind === "event" && "is-event")} style={{ order: c.start }}>
                      <span className="fit-time"><strong>{fromMinutes(Math.max(0, c.start))}</strong><span>{fromMinutes(c.end)}</span></span>
                      <span className="agenda-bar" aria-hidden />
                      <span className="fit-main"><span className="fit-title"><Lock size={13} aria-hidden /> {c.title}</span><span className="fit-meta">{c.source.kind === "event" ? "Meeting · from your calendar" : "Routine · protected"}</span></span>
                    </li>
                  ))}
                  {ordered.map((r) => {
                    const slot = proposal.slots.get(r.key);
                    return (
                      <motion.li key={r.key} layout="position" style={{ order: slot?.start ?? 99999 }} className={cx("fit-row", !slot && "is-out")} data-area={areas.find((a) => a.id === r.focusAreaId)?.color ?? "none"}>
                        <span className="fit-time">{slot ? <><strong>{fromMinutes(slot.start)}</strong><span>{fromMinutes(slot.end)}</span></> : <span>—</span>}</span>
                        <span className="agenda-bar" aria-hidden />
                        <span className="fit-main">
                          <span className="fit-title">{r.top !== null && <b className="rank-badge">{r.top}</b>}{r.title}</span>
                          <span className="fit-meta">
                            {slot ? <>{areas.find((a) => a.id === r.focusAreaId)?.name ?? "No focus area"} · {formatDuration(r.minutes)} · {modeLabel[r.workMode]}{slot.buffer > 0 && <span className="fit-buffer"> · +{formatDuration(slot.buffer)} buffer for outside work</span>}
                              {slot.within && <span> · in {slot.within}</span>}
                              {slot.breakBefore + slot.breakAfter > 0 && <span className="fit-break"> · {formatDuration(slot.breakBefore + slot.breakAfter)} recovery {slot.breakBefore ? "before" : "after"}</span>}</> : "No room left today — it will wait in your backlog"}
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
            {step === 0 ? `Next: top three${rows.length ? ` (${rows.length} chosen)` : ""}` : picked === 0 && freeRanks.length > 0 ? "Skip" : "Next: fit into the day"} <ArrowRight size={16} aria-hidden />
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
