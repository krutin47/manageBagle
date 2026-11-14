import { CalendarClock, CalendarPlus, Check, Clock, ListPlus, MapPin, Pencil, Plus, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { DropdownMenu } from "radix-ui";
import { useMemo, useState, type FormEvent } from "react";
import { Link, useSearchParams } from "react-router";
import { useToast } from "../../components/toast";
import { AreaChip, AreaSelect, Button, cx, DateNav, Dialog, EmptyState, ErrorNote, Field, IconButton, Input, PageHeader, Segmented, Skeleton, StatusIcon } from "../../components/ui";
import { errorMessage, type Area, type Block, type DayName, type Outcome, type Status, type Task } from "../../lib/api";
import { useDocumentTitle, useNowMinutes } from "../../lib/hooks";
import { modeLabel, STATUSES, statusLabel } from "../../lib/labels";
import { useAreas, useBacklog, useBlockMutations, useDay, useDayMutations, useThemes, useUser, useWeekBlocks } from "../../lib/queries";
import { addDays, formatDate, formatDuration, formatHours, fromMinutes, isValidISODate, parseISODate, snap, todayISO, toMinutes } from "../../lib/time";
import { BlockDialog, type BlockDraft } from "../planner/BlockDialog";
import { Variance } from "../planner/PlannerPage";
import { BrainDumpDialog, dueLabel, valueScore } from "./BrainDumpDialog";

const DAY_NAMES: DayName[] = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function greeting() {
  const h = new Date().getHours();
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
  // null = closed; otherwise the tasks to start the brain dump with (possibly none).
  const [dumping, setDumping] = useState<Task[] | null>(null);
  const backlog = useBacklog();

  const areaById = useMemo(() => new Map((areas.data ?? []).map((a) => [a.id, a])), [areas.data]);
  const blocks = useMemo(() => (blocksQuery.data ?? []).filter((b) => b.date === date), [blocksQuery.data, date]);
  const outcomes = useMemo(() => day.data?.outcomes ?? [], [day.data]);
  const theme = themes.data?.find((t) => t.day === DAY_NAMES[parseISODate(date).getDay()]);

  // A top-three outcome and its booked block are the same piece of work; show them as one.
  const rankByTask = useMemo(() => new Map(outcomes.filter((o) => o.backlogTaskId).map((o) => [o.backlogTaskId!, o.rank])), [outcomes]);
  const blockFor = (o: Outcome) => (o.backlogTaskId ? blocks.find((b) => b.backlogTaskId === o.backlogTaskId) : undefined);

  const planned = blocks.reduce((s, b) => s + b.plannedMinutes, 0);
  const logged = blocks.reduce((s, b) => s + (b.actualMinutes ?? 0), 0);
  const deep = blocks.filter((b) => b.workMode === "DeepFocus").reduce((s, b) => s + b.plannedMinutes, 0);
  const done = blocks.filter((b) => b.status === "Done").length;

  const loading = blocksQuery.isPending || day.isPending;
  const blank = !loading && !blocksQuery.isError && !day.isError && blocks.length === 0 && outcomes.length === 0;

  const newBlock = (seed: Partial<BlockDraft> = {}, minutes = 60) => {
    const last = blocks.at(-1);
    const startMin = last ? Math.min(toMinutes(last.start) + last.plannedMinutes, 23 * 60) : isToday ? Math.min(snap(new Date().getHours() * 60 + new Date().getMinutes() + 15, 30), 23 * 60) : 9 * 60;
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
              <Button variant="primary" icon={<ListPlus size={18} aria-hidden />} onClick={() => setDumping([])}>
                Brain dump
              </Button>
            )}
          </>
        }
      />

      {blank ? (
        <motion.section className="plan-hero" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
          <div>
            <h2>{isToday ? "What does today need to hold?" : "Nothing planned for this day yet"}</h2>
            <p>Brain dump everything on your mind, pick the three with the highest value, and it gets fitted into the day for you.</p>
            <div className="plan-hero-actions">
              <Button variant="primary" size="lg" icon={<ListPlus size={18} aria-hidden />} onClick={() => setDumping([])}>
                Start a brain dump
              </Button>
              <button type="button" className="link-btn" onClick={() => newBlock()}>or add a single block</button>
            </div>
          </div>
          <ol className="plan-hero-steps" aria-hidden>
            <li><b>1</b> Brain dump</li>
            <li><b>2</b> Pick your top three</li>
            <li><b>3</b> Fit it into the day</li>
          </ol>
        </motion.section>
      ) : (
        <>
          <section className="stat-row" aria-label="Day totals">
            <Stat label="Planned" value={formatHours(planned)} unit="h" />
            <Stat label="Logged" value={formatHours(logged)} unit="h" note={planned > 0 && logged > 0 ? `${Math.round((logged / planned) * 100)}% of plan` : "what you record"} />
            <Stat label="Deep focus" value={formatHours(deep)} unit="h" />
            <Stat label="Blocks done" value={String(done)} unit={`/ ${blocks.length}`} />
          </section>

          <section aria-labelledby="big3" className="today-section">
            <header className="section-head">
              <span className="section-step">1</span>
              <div>
                <h2 id="big3">Top three</h2>
                <p>If only these get done, today was a good day.</p>
              </div>
            </header>
            {day.isError ? (
              <ErrorNote onRetry={() => day.refetch()}>We could not load this day.</ErrorNote>
            ) : (
              <ol className="outcomes">
                {[1, 2, 3].map((rank) => {
                  const outcome = outcomes.find((o) => o.rank === rank);
                  return (
                    <OutcomeSlot
                      key={rank}
                      rank={rank}
                      loading={day.isPending}
                      outcome={outcome}
                      block={outcome && blockFor(outcome)}
                      area={outcome?.focusAreaId ? areaById.get(outcome.focusAreaId) : undefined}
                      date={date}
                      onEdit={() => setEditing(outcome ?? { rank, result: "", focusAreaId: null, nextAction: "", status: "Planned", minutesNeeded: null })}
                      onSchedule={(o) => newBlock({ title: o.result, focusAreaId: o.focusAreaId, priority: "High" }, o.minutesNeeded ?? 60)}
                    />
                  );
                })}
              </ol>
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
                <EmptyState icon={<CalendarPlus size={22} />} title="Nothing has a time yet" body="An outcome without a slot is a wish. Give your top three real time on the clock." action={<Button variant="primary" onClick={() => setDumping([])}>Brain dump</Button>} />
              ) : (
                <Agenda blocks={blocks} areaById={areaById} rankByTask={rankByTask} showNow={isToday} onOpen={setDraft} />
              )}
            </div>
          </section>

        </>
      )}

      <DueSoon tasks={backlog.data ?? []} areaById={areaById} date={date} onAdd={(t) => setDumping([t])} />

      <BlockDialog draft={draft} areas={areas.data ?? []} onClose={() => setDraft(null)} />
      <OutcomeDialog date={date} outcome={editing} areas={areas.data ?? []} onClose={() => setEditing(null)} />
      <BrainDumpDialog open={dumping !== null} seed={dumping ?? undefined} date={date} areas={areas.data ?? []} blocks={blocks} takenRanks={outcomes.map((o) => o.rank)} onClose={() => setDumping(null)} />
    </>
  );
}

function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        <motion.span key={value} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          {value}
        </motion.span>
        {unit && <small>{unit}</small>}
      </span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

// ---- Big three -------------------------------------------------------------------------------

function OutcomeSlot({ rank, outcome, block, area, loading, date, onEdit, onSchedule }: { rank: number; outcome?: Outcome; block?: Block; area?: Area; loading: boolean; date: string; onEdit: () => void; onSchedule: (o: Outcome) => void }) {
  const { saveOutcome } = useDayMutations(date);
  if (loading) {
    return (
      <li className="outcome"><span className="outcome-rank">{rank}</span><div className="outcome-body"><Skeleton height={18} width="70%" /><Skeleton height={12} width="40%" /></div></li>
    );
  }
  if (!outcome) {
    return (
      <li className="outcome is-empty">
        <span className="outcome-rank">{rank}</span>
        <button type="button" className="outcome-add" onClick={onEdit}>
          <Plus size={16} aria-hidden /> {rank === 1 ? "What must be true by tonight?" : "Add an outcome"}
        </button>
      </li>
    );
  }
  const isDone = outcome.status === "Done";
  return (
    <li className={cx("outcome", isDone && "is-done")}>
      <button
        type="button"
        className="outcome-check"
        role="checkbox"
        aria-checked={isDone}
        aria-label={`Outcome ${rank} done`}
        onClick={() => saveOutcome.mutate({ ...outcome, status: isDone ? "Planned" : "Done" })}
      >
        <AnimatePresence initial={false} mode="wait">
          {isDone ? (
            <motion.span key="check" initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 600, damping: 24 }}>
              <Check size={16} strokeWidth={3} aria-hidden />
            </motion.span>
          ) : (
            <motion.span key="rank" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              {rank}
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
        <IconButton size="sm" label="Edit outcome" onClick={onEdit}><Pencil size={16} /></IconButton>
      </div>
    </li>
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

function Agenda({ blocks, areaById, rankByTask, showNow, onOpen }: { blocks: Block[]; areaById: Map<string, Area>; rankByTask: Map<string, number>; showNow: boolean; onOpen: (b: Block) => void }) {
  const now = useNowMinutes();
  const nowIndex = showNow ? blocks.findIndex((b) => toMinutes(b.start) + b.plannedMinutes > now) : -1;
  return (
    <ul className="agenda">
      <AnimatePresence initial={false}>
        {blocks.map((b, i) => (
          <motion.li key={b.id} layout="position" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.22 }}>
            {i === nowIndex && (
              <div className="agenda-now" aria-label={`Now, ${fromMinutes(now)}`}>
                <span>{toMinutes(b.start) <= now ? "Now" : `Next · in ${formatDuration(toMinutes(b.start) - now)}`}</span>
              </div>
            )}
            <AgendaRow block={b} rank={b.backlogTaskId ? rankByTask.get(b.backlogTaskId) : undefined} area={b.focusAreaId ? areaById.get(b.focusAreaId) : undefined} onOpen={() => onOpen(b)} />
          </motion.li>
        ))}
      </AnimatePresence>
    </ul>
  );
}

function AgendaRow({ block, rank, area, onOpen }: { block: Block; rank?: number; area?: Area; onOpen: () => void }) {
  const toast = useToast();
  const { progress } = useBlockMutations();

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
        <span className="agenda-meta">
          {area?.name ?? "No area"} · {modeLabel[block.workMode]} · {formatDuration(block.plannedMinutes)}
          {block.isOutside && <> · <span className="outside-tag"><MapPin size={12} aria-hidden /> outside</span></>}
          {block.varianceMinutes !== null && <> · <Variance minutes={block.varianceMinutes} /></>}
        </span>
      </div>
      {/* Keyed on the saved value so the field resets whenever the server's number changes. */}
      <ActualInput key={block.actualMinutes ?? "empty"} label={`Actual minutes for ${block.title}`} saved={block.actualMinutes} onCommit={commitActual} />
      <DropdownMenu.Root>
        <DropdownMenu.Trigger className="status-btn" data-status={block.status} aria-label={`Status: ${statusLabel[block.status]}. Change status`}>
          <StatusIcon status={block.status} size={16} />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content className="menu" align="end" sideOffset={6}>
            <DropdownMenu.RadioGroup value={block.status} onValueChange={(v) => setStatus(v as Status)}>
              {STATUSES.map((s) => (
                <DropdownMenu.RadioItem key={s} value={s} className="menu-item">
                  <StatusIcon status={s} size={16} /> {statusLabel[s]}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
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
