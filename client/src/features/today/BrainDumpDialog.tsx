import { ArrowLeft, ArrowRight, CalendarDays, Check, Clock, Coffee, CornerDownLeft, Gauge, Inbox, Lock, MapPin, Plus, Sparkles, Wand2, X, Zap } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { useToast } from "../../components/toast";
import { DateChip, OptionChip, Tip } from "../../components/OptionChip";
import { Button, cx, Dialog, ErrorNote, IconButton, Segmented } from "../../components/ui";
import { errorMessage, type Area, type Block, type PlanItem, type Priority, type Task, type WorkMode } from "../../lib/api";
import { dueQuickPicks, priorityOf, rowFromTask, sortRows, topicGroups, valueScore, withWorkMode, type Row, type SortMode } from "./brainDump";

export { valueScore };
import { modeLabel, PRIORITIES, WORK_MODES } from "../../lib/labels";
import { busyFromBlocks, commitmentsOn } from "../../lib/commitments";
import { useBacklog, useCommitments, usePlanDay, usePreferences } from "../../lib/queries";
import { proposeSchedule } from "../../lib/schedule";
import { addDays, formatDate, formatDuration, fromMinutes, nowMinutes, snap, todayISO, toMinutes } from "../../lib/time";

const LENGTHS = [15, 30, 45, 60, 90, 120, 180, 240];
const STEPS = ["Brain dump", "Pick your top three", "Fit it into the day"];
const SORTS: { value: SortMode; label: string }[] = [
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
  const [batch, setBatch] = useState(true);
  const [text, setText] = useState("");
  const [from, setFrom] = useState(() => fromMinutes(defaultStart(date, blocks)));
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const nextKey = useRef(1);
  const sent = useRef({ fingerprint: "", key: "" });

  // Ranks already held by outcomes that are not part of this plan stay theirs.
  const freeRanks = [1, 2, 3].filter((r) => !takenRanks.includes(r));
  const patch = (key: string, p: Partial<Row>) => setRows((list) => list.map((r) => (r.key === key ? { ...r, ...p } : r)));

  const add = (e: FormEvent) => {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;
    const last = rows.at(-1);
    // A new line inherits topic and kind of work from the one above: people dump related things in runs.
    const fresh: Row = { key: `n${nextKey.current++}`, taskId: null, title, minutes: 30, minutesChosen: false, focusAreaId: last?.focusAreaId ?? null, workMode: "ShallowWork", isOutside: false, impact: "Medium", dueDate: null, priorityOverride: null, breakMinutes: null, top: null };
    setRows([...rows, withWorkMode(fresh, last?.workMode ?? "ShallowWork")]);
    setText("");
    input.current?.focus();
  };

  const addTask = (t: Task) => setRows((list) => [...list, rowFromTask(t)]);

  // Suggestions: open, unbooked backlog tasks — what is due soonest first, then what is worth most.
  const today = todayISO();
  const suggestions = (backlog.data ?? [])
    .filter((t) => t.status !== "Done" && t.status !== "Skipped" && !t.scheduledDate && !rows.some((r) => r.taskId === t.id))
    .sort((a, b) => (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") || valueScore(b, today) - valueScore(a, today));

  const view = sortRows(rows, sort, areas);
  const areaOf = (id: string | null) => areas.find((a) => a.id === id);
  const areaOptions = [{ value: "", label: "No focus area", area: "none" }, ...areas.map((a) => ({ value: a.id, label: a.name, area: a.color as string }))];

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
                <form className="capture plan-capture" onSubmit={add}>
                  <Plus size={18} aria-hidden />
                  <input ref={input} autoFocus aria-label="What needs doing?" placeholder="What needs doing? Type it and press Enter…" maxLength={200} value={text} onChange={(e) => setText(e.target.value)} />
                  <kbd aria-hidden><CornerDownLeft size={12} /> Enter</kbd>
                </form>

                {rows.length === 0 ? (
                  <p className="plan-hint">Write everything down first — one line each, no sorting, no judging. You will pick your top three next.</p>
                ) : (
                  <>
                    {rows.length > 1 && (
                      <div className="dump-sort">
                        <span className="field-label" id="dump-sort-label">Sort by</span>
                        <Segmented size="sm" label="Sort the list by" value={sort} onChange={setSort} options={SORTS} />
                        <span className="sr-only" aria-live="polite">{`Sorted ${SORTS.find((x) => x.value === sort)!.label.toLowerCase()}`}</span>
                      </div>
                    )}
                    <ul className="dump-rows">
                      <AnimatePresence initial={false}>
                        {(sort === "topic" ? topicGroups(view) : [{ focusAreaId: undefined, rows: view }]).flatMap((group) => [
                          ...(group.focusAreaId !== undefined ? [
                            <motion.li layout="position" key={`h-${group.focusAreaId ?? "none"}`} className="dump-group" data-area={areaOf(group.focusAreaId)?.color ?? "none"}>
                              <span className="area-dot" aria-hidden />{areaOf(group.focusAreaId)?.name ?? "No focus area"}
                              <span className="dump-group-count">{group.rows.length} · {formatDuration(group.rows.reduce((t, r) => t + r.minutes, 0))}</span>
                            </motion.li>,
                          ] : []),
                          ...group.rows.map((r) => {
                            const area = areaOf(r.focusAreaId);
                            const late = r.dueDate !== null && r.dueDate <= today;
                            return (
                              <motion.li key={r.key} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.18 }} className="dump-row" data-area={area?.color ?? "none"}>
                                <span className="agenda-bar" aria-hidden />
                                <input className="cell-input plan-title" aria-label="Task" maxLength={200} value={r.title} onChange={(e) => patch(r.key, { title: e.target.value })} />
                                <IconButton size="sm" label={`Remove ${r.title}`} onClick={() => setRows(rows.filter((x) => x.key !== r.key))}><X size={15} /></IconButton>
                                <div className="dump-chips" role="group" aria-label={`Options for ${r.title}`}>
                                  <OptionChip label="Length" icon={<Clock size={13} aria-hidden />} value={String(r.minutes)}
                                    options={[...new Set([...LENGTHS, r.minutes])].sort((x, y) => x - y).map((m) => ({ value: String(m), label: formatDuration(m) }))}
                                    onChange={(v) => patch(r.key, { minutes: Number(v), minutesChosen: true })} />
                                  <OptionChip label="Kind of work" icon={<Zap size={13} aria-hidden />} value={r.workMode}
                                    options={WORK_MODES.map((m) => ({ value: m, label: modeLabel[m] }))}
                                    onChange={(v) => setRows((list) => list.map((x) => (x.key === r.key ? withWorkMode(x, v as WorkMode) : x)))} />
                                  <OptionChip label="Focus area" area={area?.color ?? "none"} value={r.focusAreaId ?? ""} options={areaOptions}
                                    onChange={(v) => patch(r.key, { focusAreaId: v || null })} />
                                  <OptionChip label="Outcome impact" icon={<Gauge size={13} aria-hidden />} strong={r.impact === "High"} value={r.impact}
                                    options={PRIORITIES.map((v) => ({ value: v, label: `${v} impact` }))}
                                    onChange={(v) => patch(r.key, { impact: v as Priority })} />
                                  <OptionChip label="Recovery break" icon={<Coffee size={13} aria-hidden />} value={r.breakMinutes === null ? "area" : String(r.breakMinutes)}
                                    options={[
                                      { value: "area", label: area && area.breakMinutes > 0 ? `${formatDuration(area.breakMinutes)} break (area)` : "No break" },
                                      ...[0, 5, 10, 15, 20, 30].map((m) => ({ value: String(m), label: m === 0 ? "No break" : `${formatDuration(m)} break` })),
                                    ].filter((o, i, all) => all.findIndex((x) => x.label === o.label) === i)}
                                    onChange={(v) => patch(r.key, { breakMinutes: v === "area" ? null : Number(v) })} />
                                  <DateChip label="Due date" icon={<CalendarDays size={13} aria-hidden />} value={r.dueDate} warn={late}
                                    display={r.dueDate ? dueLabel(r.dueDate, today) : "No due date"} quickPicks={dueQuickPicks(today)}
                                    onChange={(v) => patch(r.key, { dueDate: v, priorityOverride: null })} />
                                  <Tip content={OUTSIDE_TIP}>
                                    <button type="button" className={cx("opt-chip opt-icon", r.isOutside && "is-on")} aria-pressed={r.isOutside} aria-label="Outside work" onClick={() => patch(r.key, { isOutside: !r.isOutside })}>
                                      <MapPin size={15} aria-hidden />
                                    </button>
                                  </Tip>
                                </div>
                              </motion.li>
                            );
                          }),
                        ])}
                      </AnimatePresence>
                    </ul>
                  </>
                )}

                {suggestions.length > 0 && (
                  <div className="plan-suggest">
                    <span className="field-label"><Inbox size={14} aria-hidden /> Suggested from your backlog — due soonest first</span>
                    <div className="plan-suggest-list">
                      {suggestions.slice(0, 8).map((t) => (
                        <button key={t.id} type="button" className="suggest-chip" onClick={() => addTask(t)}>
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
                    <li key={`r-${c.source.sourceId}-${c.start}`} className="fit-row is-routine" style={{ order: c.start }}>
                      <span className="fit-time"><strong>{fromMinutes(Math.max(0, c.start))}</strong><span>{fromMinutes(c.end)}</span></span>
                      <span className="agenda-bar" aria-hidden />
                      <span className="fit-main"><span className="fit-title"><Lock size={13} aria-hidden /> {c.title}</span><span className="fit-meta">Routine · protected</span></span>
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
