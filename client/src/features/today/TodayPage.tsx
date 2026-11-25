import { TriangleAlert, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, Check, Clock, Clock3, Coffee, MapPin, NotebookPen, Pencil, Play, Plus, Repeat, RotateCcw, Trash2, Utensils } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useToast } from "../../components/toast";
import { AreaChip, AreaSelect, Button, cx, DateNav, Dialog, EmptyState, ErrorNote, Field, IconButton, Input, PageHeader, Segmented, Skeleton, StatusIcon } from "../../components/ui";
import { errorMessage, type Area, type Block, type DayName, type Outcome, type Status, type Task } from "../../lib/api";
import { useDocumentTitle, useNowMinutes } from "../../lib/hooks";
import { modeLabel, STATUSES, statusLabel } from "../../lib/labels";
import { clashesFor, clashLabel, commitmentsOn } from "../../lib/commitments";
import { useAreas, useBacklog, useCommitments, useBlockMutations, useDay, useDayMutations, useThemes, useUser, useWeekBlocks } from "../../lib/queries";
import { addDays, nowMinutes, formatDate, formatDuration, formatHours, fromMinutes, isValidISODate, parseISODate, snap, todayISO, toMinutes } from "../../lib/time";
import { BlockDialog, type BlockDraft } from "../planner/BlockDialog";
import { Variance } from "../../components/Variance";
import { useBrainDump } from "../capture/BrainDump";
import { RunningTag, TimerButton, useFocusTimer } from "../timer/TimerProvider";
import { dueLabel, PlanDayDialog, valueScore } from "./PlanDayDialog";
import { rollingTopThree, type FocusItem } from "./topThree";

const DAY_NAMES: DayName[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function greeting() {
  const h = Math.floor(nowMinutes() / 60);
  return h < 5 ? "Still up" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

export function TodayPage() {
  const [params, setParams] = useSearchParams();
  const date = isValidISODate(params.get("date")) ? params.get("date")! : todayISO();
  const isToday = date === todayISO();
  useDocumentTitle(isToday ? "Today" : formatDate(date, "medium"));

  const user = useUser();
  const areas = useAreas();
  const blocksQuery = useWeekBlocks(date);
  const day = useDay(date);
  const themes = useThemes();
  const [draft, setDraft] = useState<BlockDraft | null>(null);
  const [editing, setEditing] = useState<Outcome | null>(null);
  // null = closed; otherwise the tasks already chosen when Plan my day opens (possibly none).
  const [planning, setPlanning] = useState<Task[] | null>(null);
  const brainDump = useBrainDump();
  const backlog = useBacklog();

  const areaById = useMemo(() => new Map((areas.data ?? []).map((a) => [a.id, a])), [areas.data]);
  const blocks = useMemo(() => (blocksQuery.data ?? []).filter((b) => b.date === date), [blocksQuery.data, date]);
  const outcomes = useMemo(() => day.data?.outcomes ?? [], [day.data]);
  const theme = themes.data?.find((t) => t.day === DAY_NAMES[parseISODate(date).getDay()]);
  const commitments = useCommitments(date);
  const fixed = useMemo(() => commitmentsOn(date, commitments.data ?? []), [date, commitments.data]);
  const routineBands = useMemo(() => fixed.map((c) => ({
    title: c.title, start: c.start, end: c.end, isMeal: c.source.isMeal, policy: c.policy, key: `${c.source.sourceId}-${c.source.date}-${c.start}`, kind: c.source.kind, color: c.source.color,
  })), [fixed]);

  // A top-three outcome and its booked block are the same piece of work; show them as one.
  const rankByTask = useMemo(() => new Map(outcomes.filter((o) => o.backlogTaskId).map((o) => [o.backlogTaskId!, o.rank])), [outcomes]);
  const rolling = useMemo(() => rollingTopThree(outcomes, blocks), [outcomes, blocks]);
  const freeRanks = [1, 2, 3].filter((r) => !outcomes.some((o) => o.rank === r));

  const planned = blocks.reduce((s, b) => s + b.plannedMinutes, 0);
  const logged = blocks.reduce((s, b) => s + (b.actualMinutes ?? 0), 0);
  const deep = blocks.filter((b) => b.workMode === "DeepFocus").reduce((s, b) => s + b.plannedMinutes, 0);
  const done = blocks.filter((b) => b.status === "Done").length;

  const loading = blocksQuery.isPending || day.isPending;
  const blank = !loading && !blocksQuery.isError && !day.isError && blocks.length === 0 && outcomes.length === 0;

  const newBlock = (seed: Partial<BlockDraft> = {}, minutes = 60) => {
    const last = blocks.at(-1);
    const startMin = last ? Math.min(toMinutes(last.start) + last.plannedMinutes, 23 * 60) : isToday ? Math.min(snap(nowMinutes() + 15, 30), 23 * 60) : 9 * 60;
    setDraft({ date, start: fromMinutes(startMin), end: fromMinutes(startMin + minutes), ...seed });
  };

  return (
    <>
      <PageHeader
        eyebrow={isToday ? `${greeting()}, ${user.displayName.split(" ")[0]}` : "Daily focus"}
        title={formatDate(date, "long")}
        sub={theme?.primaryFocus ? <><span className="theme-tag">{theme.primaryFocus}</span>{theme.outcome && <span className="theme-outcome">{theme.outcome}</span>}</> : undefined}
        actions={
          <>
            <DateNav label="Day" value={date} step={1} onChange={(d) => setParams(d === todayISO() ? {} : { date: d }, { replace: true })}>
              <Input type="date" className="date-jump" aria-label="Jump to date" value={date} onChange={(e) => e.target.value && setParams({ date: e.target.value }, { replace: true })} />
            </DateNav>
            {!blank && (
              <Button variant="primary" icon={<CalendarCheck size={18} aria-hidden />} onClick={() => setPlanning([])}>
                Plan my day
              </Button>
            )}
          </>
        }
      />

      {blank ? (
        <motion.section className="plan-hero" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div>
            <h2>{isToday ? "What does today need to hold?" : "Nothing planned for this day yet"}</h2>
            <p>Choose from your backlog, pick the three with the highest value, and they are fitted around your routines and meetings.</p>
            <div className="plan-hero-actions">
              <Button variant="primary" size="lg" icon={<CalendarCheck size={18} aria-hidden />} onClick={() => setPlanning([])}>
                Plan my day
              </Button>
              <Button icon={<NotebookPen size={18} aria-hidden />} onClick={brainDump.open}>Empty your head first</Button>
              <button type="button" className="link-btn" onClick={() => newBlock()}>or add a single block</button>
            </div>
          </div>
          <ol className="plan-hero-steps" aria-hidden>
            <li><b>1</b> Choose from your backlog</li>
            <li><b>2</b> Pick your top three</li>
            <li><b>3</b> Fit it into the day</li>
          </ol>
        </motion.section>
      ) : (
        <>
          {/* One quiet line instead of four tiles: the Week page has the full figures. */}
          <section className="day-summary" aria-label="Day totals">
            <span><strong>{formatHours(planned)}h</strong> planned</span>
            <span><strong>{formatHours(logged)}h</strong> logged{planned > 0 && logged > 0 ? ` (${Math.round((logged / planned) * 100)}%)` : ""}</span>
            <span><strong>{formatHours(deep)}h</strong> deep focus</span>
            <span><strong>{done} / {blocks.length}</strong> blocks done</span>
          </section>

          {isToday && <NowCard blocks={blocks} areaById={areaById} />}

          <section aria-labelledby="big3" className="today-section">
            <header className="section-head">
              <span className="section-step">1</span>
              <div>
                <h2 id="big3">Top three</h2>
                <p>If only these get done, today was a good day. Finish one and the next in line moves up.</p>
              </div>
            </header>
            {day.isError ? (
              <ErrorNote onRetry={() => day.refetch()}>We could not load this day.</ErrorNote>
            ) : (
              <>
                <ol className="outcomes">
                  <AnimatePresence initial={false} mode="popLayout">
                    {/* Until the day's outcomes arrive, blocks alone would look like "next in line": show placeholders. */}
                    {day.isPending && [1, 2, 3].map((n) => (
                      <OutcomeSlot key={`loading-${n}`} rank={n} position={n} loading date={date} onEdit={() => undefined} onSchedule={() => undefined} />
                    ))}
                    {!day.isPending && rolling.current.map((item, i) =>
                      item.kind === "outcome" ? (
                        <OutcomeSlot
                          key={item.key}
                          rank={item.outcome.rank}
                          position={i + 1}
                          loading={day.isPending}
                          outcome={item.outcome}
                          block={item.block}
                          area={item.outcome.focusAreaId ? areaById.get(item.outcome.focusAreaId) : undefined}
                          date={date}
                          onEdit={() => setEditing(item.outcome)}
                          onSchedule={(o) => newBlock({ title: o.result, focusAreaId: o.focusAreaId, priority: "High" }, o.minutesNeeded ?? 60)}
                        />
                      ) : (
                        <NextInLine key={item.key} position={i + 1} block={item.block} area={item.block.focusAreaId ? areaById.get(item.block.focusAreaId) : undefined} onOpen={() => setDraft(item.block)} />
                      ),
                    )}
                    {!day.isPending && freeRanks.slice(0, Math.max(0, 3 - rolling.current.length)).map((rank, i) => (
                      <OutcomeSlot key={`empty-${rank}`} rank={rank} position={rolling.current.length + i + 1} loading={day.isPending} date={date}
                        onEdit={() => setEditing({ rank, result: "", focusAreaId: null, nextAction: "", status: "Planned", minutesNeeded: null, backlogTaskId: null })} onSchedule={() => undefined} />
                    ))}
                  </AnimatePresence>
                </ol>
                {!day.isPending && rolling.current.length === 0 && freeRanks.length === 0 && (
                  <p className="plan-hint">Everything you chose for {isToday ? "today" : "this day"} is done. Plan a little more, or call it a day.</p>
                )}
                <DoneToday items={rolling.done} date={date} />
              </>
            )}
          </section>

          <section aria-labelledby="schedule" className="today-section">
            <header className="section-head">
              <span className="section-step">2</span>
              <div>
                <h2 id="schedule">Schedule</h2>
                <p>Work down the list. Tick a block when it is done and note how long it really took.</p>
              </div>
              <Button size="sm" icon={<Plus size={16} aria-hidden />} onClick={() => newBlock()}>
                Add block
              </Button>
            </header>
            <div className="card card-flush">
              {blocksQuery.isError ? (
                <ErrorNote onRetry={() => blocksQuery.refetch()}>We could not load your blocks.</ErrorNote>
              ) : blocksQuery.isPending ? (
                <div className="stack"><Skeleton height={56} radius={10} /><Skeleton height={56} radius={10} /><Skeleton height={56} radius={10} /></div>
              ) : blocks.length === 0 ? (
                <EmptyState icon={<CalendarPlus size={22} />} title="Nothing has a time yet" body="An outcome without a slot is a wish. Use Plan my day, above, to give your top three real time on the clock." />
              ) : (
                <Agenda blocks={blocks} routines={routineBands} fixed={fixed} areaById={areaById} rankByTask={rankByTask} showNow={isToday} onOpen={setDraft} />
              )}
            </div>
          </section>

        </>
      )}

      <DueSoon tasks={backlog.data ?? []} areaById={areaById} date={date} onAdd={(t) => setPlanning([t])} />

      <BlockDialog draft={draft} areas={areas.data ?? []} onClose={() => setDraft(null)} />
      <OutcomeDialog date={date} outcome={editing} areas={areas.data ?? []} onClose={() => setEditing(null)} />
      <PlanDayDialog open={planning !== null} seed={planning ?? undefined} date={date} areas={areas.data ?? []} blocks={blocks} takenRanks={outcomes.map((o) => o.rank)} onClose={() => setPlanning(null)} />
    </>
  );
}

// ---- Big three -------------------------------------------------------------------------------

const slotMotion = { layout: true, initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, scale: 0.97, transition: { duration: 0.15 } }, transition: { duration: 0.24, ease: [0.22, 1, 0.36, 1] } } as const;

/** `position` is where it sits in today's three; `rank` is the number it was given when chosen. */
function OutcomeSlot({ rank, position, outcome, block, area, loading, date, onEdit, onSchedule }: { rank: number; position: number; outcome?: Outcome; block?: Block; area?: Area; loading: boolean; date: string; onEdit: () => void; onSchedule: (o: Outcome) => void }) {
  const { saveOutcome } = useDayMutations(date);
  if (loading) {
    return (
      <li className="outcome"><span className="outcome-rank">{position}</span><div className="outcome-body"><Skeleton height={18} width="70%" /><Skeleton height={12} width="40%" /></div></li>
    );
  }
  if (!outcome) {
    return (
      <motion.li {...slotMotion} className="outcome is-empty">
        <span className="outcome-rank">{position}</span>
        <button type="button" className="outcome-add" onClick={onEdit}>
          <Plus size={16} aria-hidden /> {position === 1 ? "What must be true by tonight?" : "Add an outcome"}
        </button>
      </motion.li>
    );
  }
  const isDone = outcome.status === "Done";
  return (
    <motion.li {...slotMotion} className={cx("outcome", isDone && "is-done")}>
      <button
        type="button"
        className="outcome-check"
        role="checkbox"
        aria-checked={isDone}
        aria-label={`Outcome ${rank} done: ${outcome.result}`}
        onClick={() => saveOutcome.mutate({ ...outcome, status: isDone ? "Planned" : "Done" })}
      >
        <AnimatePresence initial={false} mode="wait">
          {isDone ? (
            <motion.span key="check" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 600, damping: 24 }}>
              <Check size={16} strokeWidth={3} aria-hidden />
            </motion.span>
          ) : (
            <motion.span key="rank" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {position}
            </motion.span>
          )}
        </AnimatePresence>
      </button>
      <div className="outcome-body">
        <p className="outcome-result">{outcome.result}</p>
        {outcome.nextAction && <p className="outcome-next"><span>Next:</span> {outcome.nextAction}</p>}
        <div className="outcome-meta">
          <AreaChip area={area} compact />
          {block ? (
            <span className="outcome-when"><Clock size={13} aria-hidden /> {block.start.slice(0, 5)}–{block.end.slice(0, 5)}</span>
          ) : outcome.status !== "Done" ? (
            <button type="button" className="outcome-book" onClick={() => onSchedule(outcome)}><CalendarPlus size={13} aria-hidden /> Book time{outcome.minutesNeeded ? ` · ${formatDuration(outcome.minutesNeeded)}` : ""}</button>
          ) : null}
          {outcome.status !== "Planned" && outcome.status !== "Done" && <span className="status-pill" data-status={outcome.status}><StatusIcon status={outcome.status} size={12} />{statusLabel[outcome.status]}</span>}
        </div>
      </div>
      <div className="outcome-actions">
        {block && <RunningTag block={block} />}
        <IconButton size="sm" label="Edit outcome" onClick={onEdit}><Pencil size={16} /></IconButton>
      </div>
    </motion.li>
  );
}

/** A task that moved up into today's three because an earlier one was finished or dropped (P2-F2). */
function NextInLine({ position, block, area, onOpen }: { position: number; block: Block; area?: Area; onOpen: () => void }) {
  const toast = useToast();
  const { progress } = useBlockMutations();
  const finish = () => {
    // With no time recorded, assume the plan; time from the timer is kept as it is.
    const fill = block.actualMinutes === null && block.trackedSeconds === 0 && !block.timerStartedAt ? { actualMinutes: block.plannedMinutes } : {};
    progress.mutate({ block, status: "Done", ...fill }, { onError: (err) => toast.error(errorMessage(err)) });
  };
  return (
    <motion.li {...slotMotion} className="outcome is-next-in-line">
      <button type="button" className="outcome-check" role="checkbox" aria-checked={false} aria-label={`Done: ${block.title}`} onClick={finish}>{position}</button>
      <div className="outcome-body">
        <button type="button" className="row-link outcome-result" onClick={onOpen}>{block.title}</button>
        <div className="outcome-meta">
          <AreaChip area={area} compact />
          <span className="outcome-when"><Clock size={13} aria-hidden /> {block.start.slice(0, 5)}–{block.end.slice(0, 5)}</span>
          <span className="moved-up">Next in line</span>
        </div>
      </div>
      <div className="outcome-actions"><RunningTag block={block} /></div>
    </motion.li>
  );
}

/** Finished and dropped items leave the three and are kept here, each one click from being reopened. */
function DoneToday({ items, date }: { items: FocusItem[]; date: string }) {
  const toast = useToast();
  const { saveOutcome } = useDayMutations(date);
  const { progress } = useBlockMutations();
  if (items.length === 0) return null;
  const onError = (err: unknown) => toast.error(errorMessage(err));
  const reopen = (item: FocusItem) =>
    item.kind === "outcome" ? saveOutcome.mutate({ ...item.outcome, status: "Planned" }, { onError }) : progress.mutate({ block: item.block, status: "Planned" }, { onError });
  const done = items.filter((i) => i.status === "Done").length;
  return (
    <details className="done-today">
      <summary>Done for the day <span>{done} finished{items.length > done ? ` · ${items.length - done} dropped or put off` : ""}</span></summary>
      <ul>
        {items.map((item) => {
          const title = item.kind === "outcome" ? item.outcome.result : item.block.title;
          return (
            <li key={item.key} data-status={item.status}>
              <StatusIcon status={item.status} size={15} />
              <span className="done-title">{title}</span>
              <em>{item.status === "Done" ? "Done" : statusLabel[item.status]}</em>
              <IconButton size="sm" label={`Reopen ${title}`} onClick={() => reopen(item)}><RotateCcw size={14} /></IconButton>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

/** P2-F1: what is running, or happening now, or next — with its timer — at the top of Today. */
function NowCard({ blocks, areaById }: { blocks: Block[]; areaById: Map<string, Area> }) {
  const timer = useFocusTimer();
  const now = useNowMinutes();
  const isOpen = (b: Block) => b.status === "Planned" || b.status === "InProgress";
  const ends = (b: Block) => toMinutes(b.start) + b.plannedMinutes;
  const running = timer.running ? blocks.find((b) => b.id === timer.running!.id) : undefined;
  const current = running ?? blocks.find((b) => isOpen(b) && toMinutes(b.start) <= now && ends(b) > now);
  const upcoming = blocks.filter((b) => isOpen(b) && toMinutes(b.start) > now && b.id !== current?.id).sort((a, b) => toMinutes(a.start) - toMinutes(b.start));
  const focus = current ?? upcoming[0];
  const then = current ? upcoming[0] : upcoming[1];
  if (!focus) return null;
  const area = focus.focusAreaId ? areaById.get(focus.focusAreaId) : undefined;
  const label = running ? "Now · timer running" : current ? "Now" : `Next · in ${formatDuration(toMinutes(focus.start) - now)}`;
  return (
    <motion.section layout className={cx("now-card", running && "is-running")} data-area={area?.color ?? "none"} aria-label="Now">
      <span className="agenda-bar" aria-hidden />
      <div className="now-main">
        <span className="now-label">{label}</span>
        <h2 id="now-title" className="now-title">{focus.title}</h2>
        <span className="now-meta">{focus.start.slice(0, 5)}–{focus.end.slice(0, 5)} · {area?.name ?? "No area"} · {modeLabel[focus.workMode]}</span>
        {then && <span className="now-then">Then {then.title} at {then.start.slice(0, 5)}</span>}
      </div>
      <TimerButton block={focus} />
    </motion.section>
  );
}

function OutcomeDialog({ date, outcome, areas, onClose }: { date: string; outcome: Outcome | null; areas: Area[]; onClose: () => void }) {
  return (
    <Dialog open={!!outcome} onClose={onClose} title={outcome ? `Outcome #${outcome.rank}` : "Outcome"} description="Describe the finished result you could show someone.">
      {outcome && <OutcomeForm key={outcome.rank} date={date} outcome={outcome} areas={areas} onClose={onClose} />}
    </Dialog>
  );
}

function OutcomeForm({ date, outcome, areas, onClose }: { date: string; outcome: Outcome; areas: Area[]; onClose: () => void }) {
  const toast = useToast();
  const { saveOutcome, removeOutcome } = useDayMutations(date);
  const [form, setForm] = useState(outcome);
  const existing = outcome.result !== "";

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.result.trim()) return;
    saveOutcome.mutate(form, { onError: (err) => toast.error(errorMessage(err)) });
    onClose();
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        <Field label="Specific finished result">{(p) => <Input {...p} autoFocus required maxLength={200} placeholder="e.g. Complete and test the optimizer endpoint" value={form.result} onChange={(e) => setForm({ ...form, result: e.target.value })} />}</Field>
        <Field label="Next physical action" optional hint="The very first thing you will do, small enough to start in two minutes.">
          {(p) => <Input {...p} maxLength={200} placeholder="e.g. Write one acceptance test" value={form.nextAction} onChange={(e) => setForm({ ...form, nextAction: e.target.value })} />}
        </Field>
        <div className="form-grid-2">
          <Field label="Focus area">{(p) => <AreaSelect {...p} areas={areas} value={form.focusAreaId} onChange={(focusAreaId) => setForm({ ...form, focusAreaId })} />}</Field>
          <Field label="Minutes needed" optional>
            {(p) => <Input {...p} type="number" inputMode="numeric" min={5} max={1440} step={5} value={form.minutesNeeded ?? ""} onChange={(e) => setForm({ ...form, minutesNeeded: e.target.value === "" ? null : Math.max(5, Math.min(1440, Math.round(Number(e.target.value)))) })} />}
          </Field>
        </div>
        <div className="field">
          <span className="field-label">Status</span>
          <Segmented size="sm" label="Status" value={form.status} onChange={(status) => setForm({ ...form, status })} options={STATUSES.map((s) => ({ value: s, label: statusLabel[s] }))} />
        </div>
      </div>
      <footer className="dialog-foot">
        {existing && (
          <Button variant="ghost" className="push-left danger-text" icon={<Trash2 size={16} aria-hidden />} onClick={() => { removeOutcome.mutate(outcome.rank); onClose(); }}>
            Remove
          </Button>
        )}
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={!form.result.trim()}>Save outcome</Button>
      </footer>
    </form>
  );
}

// ---- Agenda ----------------------------------------------------------------------------------

type RoutineBand = { title: string; start: number; end: number; isMeal: boolean; policy: string; key: string; kind: "routine" | "event"; color: string | null };

function Agenda({ blocks, routines, fixed, areaById, rankByTask, showNow, onOpen }: { blocks: Block[]; routines: RoutineBand[]; fixed: ReturnType<typeof commitmentsOn>; areaById: Map<string, Area>; rankByTask: Map<string, number>; showNow: boolean; onOpen: (b: Block) => void }) {
  const now = useNowMinutes();
  // The marker sits above the first block still to do; finished or dropped blocks are not "next".
  const nowIndex = showNow ? blocks.findIndex((b) => (b.status === "Planned" || b.status === "InProgress") && toMinutes(b.start) + b.plannedMinutes > now) : -1;
  // Routines sit between the blocks at their own time; they are context, not something to tick off.
  // A routine starting at the same time as a block comes first: it is the frame the block sits in.
  const routinesBefore = (i: number) => routines.filter((r) => r.start > (i === 0 ? -Infinity : toMinutes(blocks[i - 1]!.start)) && r.start <= toMinutes(blocks[i]!.start));
  const trailing = routines.filter((r) => blocks.length === 0 || r.start > toMinutes(blocks.at(-1)!.start));
  return (
    <ul className="agenda">
      <AnimatePresence initial={false}>
        {blocks.flatMap((b, i) => [...routinesBefore(i).map((r) => <RoutineRow key={r.key} band={r} />), (
          <motion.li key={b.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }}>
            {i === nowIndex && (
              <div className="agenda-now" aria-label={`Now, ${fromMinutes(now)}`}>
                <span>{toMinutes(b.start) <= now ? "Now" : `Next · in ${formatDuration(toMinutes(b.start) - now)}`}</span>
              </div>
            )}
            <AgendaRow block={b} clash={b.status === "Planned" || b.status === "InProgress" ? clashLabel(clashesFor(b, fixed)) : ""} rank={b.backlogTaskId ? rankByTask.get(b.backlogTaskId) : undefined} area={b.focusAreaId ? areaById.get(b.focusAreaId) : undefined} onOpen={() => onOpen(b)} />
          </motion.li>
        )])}
        {trailing.map((r) => <RoutineRow key={r.key} band={r} />)}
      </AnimatePresence>
    </ul>
  );
}

function RoutineRow({ band }: { band: RoutineBand }) {
  return (
    <motion.li layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className={cx("routine-row", band.kind === "event" && "is-event", band.policy !== "NoTasks" && "is-open")} data-area={band.kind === "event" ? "none" : (band.color ?? "none")} aria-label={`${band.kind === "event" ? "Meeting" : "Routine"}: ${band.title}, ${fromMinutes(Math.max(0, band.start))} to ${fromMinutes(band.end)}`}>
      <span className="agenda-time"><strong>{fromMinutes(Math.max(0, band.start))}</strong><span>{fromMinutes(band.end)}</span></span>
      <span className="agenda-bar" aria-hidden />
      <span className="routine-row-title">{band.kind === "event" ? <CalendarDays size={14} aria-hidden /> : band.isMeal ? <Utensils size={14} aria-hidden /> : <Repeat size={14} aria-hidden />}{band.title}
        <small>{band.kind === "event" ? "from your calendar" : band.policy === "NoTasks" ? "protected" : band.policy === "AnyTask" ? "open for tasks" : "for selected areas"}</small>
      </span>
    </motion.li>
  );
}

const MENU_STATUSES: { value: Status; label: string }[] = [
  { value: "Planned", label: "Not started" },
  { value: "InProgress", label: "In progress" },
  { value: "Done", label: "Done" },
];

function AgendaRow({ block, rank, area, clash, onOpen }: { block: Block; rank?: number; area?: Area; clash: string; onOpen: () => void }) {
  const toast = useToast();
  const { progress } = useBlockMutations();
  const timer = useFocusTimer();
  const now = useNowMinutes();
  const open = block.status === "Planned" || block.status === "InProgress";
  const running = timer.running?.id === block.id;
  // Actual minutes only matter once a block has begun; before that the field is noise.
  const begun = !open || block.status === "InProgress" || block.trackedSeconds > 0 || block.actualMinutes !== null || (block.date < todayISO()) || (block.date === todayISO() && toMinutes(block.start) <= now);

  const onError = (err: unknown) => toast.error(errorMessage(err));
  const setStatus = (status: Status) => {
    // Finishing a block with nothing logged assumes it took the planned time; the number stays editable.
    const fill = status === "Done" && block.actualMinutes === null ? { actualMinutes: block.plannedMinutes } : {};
    progress.mutate({ block, status, ...fill }, { onError });
  };
  const commitActual = (next: number | null) => progress.mutate(next === null ? { block, clearActual: true } : { block, actualMinutes: next }, { onError });

  return (
    <div className="agenda-row" data-area={area?.color ?? "none"} data-status={block.status}>
      <span className="agenda-time">
        <strong>{block.start.slice(0, 5)}</strong>
        <span>{block.end.slice(0, 5)}</span>
      </span>
      <span className="agenda-bar" aria-hidden />
      <div className="agenda-main">
        <button type="button" className="row-link agenda-title" onClick={onOpen}>
          {rank !== undefined && <b className="rank-badge" title={`Top three: #${rank}`}><span className="sr-only">Top three, number </span>{rank}</b>}
          {block.title}
        </button>
        <RunningTag block={block} />
        <span className="agenda-meta">
          {area?.name ?? "No area"} · {modeLabel[block.workMode]} · {formatDuration(block.plannedMinutes)}
          {block.isOutside && <> · <span className="outside-tag"><MapPin size={12} aria-hidden /> outside</span></>}
          {block.breakBeforeMinutes + block.breakAfterMinutes > 0 && <> · <span className="break-tag"><Coffee size={12} aria-hidden /> {formatDuration(block.breakBeforeMinutes + block.breakAfterMinutes)} recovery {block.breakBeforeMinutes ? "before" : "after"}</span></>}
          {block.varianceMinutes !== null && <> · <Variance minutes={block.varianceMinutes} /></>}
          {clash && <> · <span className="clash-tag"><TriangleAlert size={12} aria-hidden /> {clash}</span></>}
        </span>
      </div>
      {/* Keyed on the saved value so the field resets whenever the server's number changes. */}
      {begun ? <ActualInput key={block.actualMinutes ?? "empty"} label={`Actual minutes for ${block.title}`} saved={block.actualMinutes} onCommit={commitActual} /> : <span className="actual-placeholder" aria-hidden />}
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="status-btn" data-status={block.status} aria-label={`Status: ${statusLabel[block.status]}. Change status`}>
          <StatusIcon status={block.status} size={16} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
            <DropdownMenu.RadioGroup value={block.status} onValueChange={(v) => setStatus(v as Status)}>
              {MENU_STATUSES.map((s) => (
                <DropdownMenu.RadioItem key={s.value} value={s.value} className="menu-item">
                  <StatusIcon status={s.value} size={16} /> {s.label}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            {open && (
              <>
                <DropdownMenu.Separator className="menu-sep" />
                {!running && (
                  <DropdownMenu.Item className="menu-item" onSelect={() => timer.start(block)}>
                    <Play size={16} aria-hidden /> Start timer now
                  </DropdownMenu.Item>
                )}
                {/* Two different endings, said plainly (P2-G1): put off returns the task to To do; drop moves it to Dropped. */}
                <DropdownMenu.Item className="menu-item" onSelect={() => timer.askToStop(block, "Later")}>
                  <Clock3 size={16} aria-hidden /> Put off for later…
                </DropdownMenu.Item>
                <DropdownMenu.Item className="menu-item danger-text" onSelect={() => timer.askToStop(block, "Drop")}>
                  <Trash2 size={16} aria-hidden /> Drop it…
                </DropdownMenu.Item>
              </>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

function ActualInput({ label, saved, onCommit }: { label: string; saved: number | null; onCommit: (minutes: number | null) => void }) {
  const [text, setText] = useState(saved === null ? "" : String(saved));
  const commit = () => {
    const next = text.trim() === "" ? null : Math.max(0, Math.min(1440, Math.round(Number(text))));
    if (next !== saved && !Number.isNaN(next)) onCommit(next);
  };
  return (
    <label className="actual">
      <span className="sr-only">{label}</span>
      <input type="number" inputMode="numeric" min={0} max={1440} placeholder="—" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
      <span aria-hidden>min</span>
    </label>
  );
}

// ---- Due soon ---------------------------------------------------------------------------------

/** Open tasks that are overdue or due within a week and have no time booked yet. */
function DueSoon({ tasks, areaById, date, onAdd }: { tasks: Task[]; areaById: Map<string, Area>; date: string; onAdd: (t: Task) => void }) {
  const today = todayISO();
  const horizon = addDays(today, 7);
  const due = tasks
    .filter((t) => t.status !== "Done" && t.status !== "Skipped" && !t.scheduledDate && t.dueDate !== null && t.dueDate <= horizon)
    .sort((a, b) => a.dueDate!.localeCompare(b.dueDate!) || valueScore(b, today) - valueScore(a, today));
  if (due.length === 0) return null;

  return (
    <section aria-labelledby="due-soon" className="today-section">
      <header className="section-head">
        <span className="section-step"><CalendarClock size={15} aria-hidden /></span>
        <div>
          <h2 id="due-soon">Due soon</h2>
          <p>Not booked yet and due within a week. Give them a slot before they become urgent.</p>
        </div>
        <Link to="/backlog" className="section-link">Open backlog</Link>
      </header>
      <ul className="card card-flush due-list">
        <AnimatePresence initial={false}>
          {due.slice(0, 6).map((t) => (
            <motion.li key={t.id} layout="position" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, height: 0 }} className="due-row" data-area={(t.focusAreaId && areaById.get(t.focusAreaId)?.color) || "none"}>
              <span className={cx("due-when", t.dueDate! <= today && "is-late")}>{dueLabel(t.dueDate!, today)}</span>
              <span className="agenda-bar" aria-hidden />
              <div className="agenda-main">
                <span className="due-title">{t.title}</span>
                <span className="agenda-meta">
                  {(t.focusAreaId && areaById.get(t.focusAreaId)?.name) || "No area"}
                  {t.estimatedMinutes !== null && <> · {formatDuration(t.estimatedMinutes)}</>}
                  {t.impact === "High" && <> · <span className="impact-tag is-high">High impact</span></>}
                </span>
              </div>
              <Button size="sm" icon={<Plus size={15} aria-hidden />} onClick={() => onAdd(t)}>
                Add to {date === today ? "today" : formatDate(date, "weekdayShort")}
              </Button>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      {due.length > 6 && <p className="plan-hint">And {due.length - 6} more in your <Link to="/backlog">backlog</Link>.</p>}
    </section>
  );
}
