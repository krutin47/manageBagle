import { CalendarPlus, CornerDownLeft, Inbox, MapPin, Pencil, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useToast } from "../../components/toast";
import { AreaChip, AreaSelect, Button, cx, Dialog, EmptyState, ErrorNote, Field, IconButton, Input, OutsideToggle, PageHeader, PriorityMark, Segmented, Select, Skeleton, StatusIcon } from "../../components/ui";
import { ApiError, errorMessage, type Area, type Status, type Task, type TaskInput, type WorkMode } from "../../lib/api";
import { useDocumentTitle } from "../../lib/hooks";
import { modeLabel, PRIORITIES, STATUSES, statusLabel, WORK_MODES } from "../../lib/labels";
import { useAreas, useBacklog, useTaskMutations } from "../../lib/queries";
import { outsideBuffer } from "../../lib/schedule";
import { Board } from "./Board";
import { formatDate, formatDuration, formatHours, fromMinutes, plannedMinutes, todayISO, toMinutes } from "../../lib/time";

type Filter = "open" | "scheduled" | "done" | "all";
const PRIORITY_RANK = { High: 0, Medium: 1, Low: 2 };
const isOpen = (t: Task) => t.status !== "Done" && t.status !== "Skipped";
const toInput = ({ title, focusAreaId, estimatedMinutes, priority, dueDate, status, nextStep, workMode, isOutside, impact }: Task): TaskInput => ({ title, focusAreaId, estimatedMinutes, priority, dueDate, status, nextStep, workMode, isOutside, impact });
const BLANK: TaskInput = { title: "", focusAreaId: null, estimatedMinutes: null, priority: "Medium", dueDate: null, status: "Planned", nextStep: "", workMode: "ShallowWork", isOutside: false, impact: "Medium" };

export function BacklogPage() {
  useDocumentTitle("Backlog");
  const toast = useToast();
  const tasks = useBacklog();
  const areas = useAreas();
  const { create, update, remove } = useTaskMutations();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "list" ? "list" : "board";
  const [filter, setFilter] = useState<Filter>("open");
  const [capture, setCapture] = useState("");
  const [editing, setEditing] = useState<Task | "new" | null>(null);
  const [scheduling, setScheduling] = useState<Task | null>(null);

  const areaById = useMemo(() => new Map((areas.data ?? []).map((a) => [a.id, a])), [areas.data]);
  const all = useMemo(() => tasks.data ?? [], [tasks.data]);
  const visible = useMemo(() => {
    const list = all.filter((t) => (filter === "all" ? true : filter === "done" ? !isOpen(t) : filter === "scheduled" ? isOpen(t) && t.scheduledDate : isOpen(t)));
    return [...list].sort((a, b) => Number(!isOpen(a)) - Number(!isOpen(b)) || PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] || (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999"));
  }, [all, filter]);

  const open = all.filter(isOpen);
  const remaining = open.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0);
  const unestimated = open.filter((t) => t.estimatedMinutes === null).length;

  const quickAdd = (e: FormEvent) => {
    e.preventDefault();
    const title = capture.trim();
    if (!title) return;
    setCapture("");
    create.mutate(
      { ...BLANK, title },
      { onError: (err) => { setCapture(title); toast.error(errorMessage(err)); } },
    );
  };

  const move = (t: Task, status: Status) => update.mutate({ id: t.id, ...toInput(t), status }, { onError: (e) => toast.error(errorMessage(e)) });
  const toggleDone = (t: Task) => update.mutate({ id: t.id, ...toInput(t), status: isOpen(t) ? "Done" : "Planned" }, { onError: (e) => toast.error(errorMessage(e)) });
  const destroy = (t: Task) =>
    remove.mutate(t.id, {
      onSuccess: () => toast.success("Task deleted", { label: "Undo", run: () => create.mutate(toInput(t)) }),
      onError: (e) => toast.error(errorMessage(e)),
    });

  return (
    <>
      <PageHeader
        eyebrow="Capture first, schedule second"
        title="Backlog"
        sub="Get it out of your head here. Only move a task onto the calendar when you can commit to it."
        actions={
          <>
            <Segmented label="View" size="sm" value={view} onChange={(v) => setParams(v === "board" ? {} : { view: v }, { replace: true })} options={[{ value: "board", label: "Board" }, { value: "list", label: "List" }]} />
            <Button onClick={() => setEditing("new")}>Add with details</Button>
          </>
        }
      />

      <form className="capture" onSubmit={quickAdd}>
        <Inbox size={18} aria-hidden />
        <input aria-label="Capture a task" placeholder="Capture a task and press Enter…" maxLength={200} value={capture} onChange={(e) => setCapture(e.target.value)} />
        <kbd aria-hidden><CornerDownLeft size={12} /> Enter</kbd>
      </form>

      <div className="backlog-bar">
        {view === "board" ? <p className="backlog-tip">Drag a card to another column to change its status.</p> : <Segmented label="Show" size="sm" value={filter} onChange={setFilter} options={[
          { value: "open", label: `Open ${open.length || ""}`.trim() },
          { value: "scheduled", label: "Scheduled" },
          { value: "done", label: "Closed" },
          { value: "all", label: "All" },
        ]} />}
        <p className="backlog-total">
          <strong className="mono">{formatHours(remaining)}h</strong> of estimated work remaining
          {unestimated > 0 && <span className="muted"> · {unestimated} without an estimate</span>}
        </p>
      </div>

      {tasks.isError ? (
        <ErrorNote onRetry={() => tasks.refetch()}>We could not load your backlog.</ErrorNote>
      ) : tasks.isPending ? (
        <div className="card stack"><Skeleton height={52} radius={10} /><Skeleton height={52} radius={10} /><Skeleton height={52} radius={10} /></div>
      ) : view === "board" && all.length > 0 ? (
        <Board tasks={all} areaById={areaById} onMove={move} onOpen={setEditing} onSchedule={setScheduling} />
      ) : visible.length === 0 ? (
        <div className="card">
          <EmptyState icon={<Inbox size={22} />} title={all.length === 0 ? "Your backlog is clear" : "Nothing in this view"} body={all.length === 0 ? "Type anything that is on your mind into the box above. You decide later what deserves a time block." : "Try another filter to see the rest of your tasks."} />
        </div>
      ) : (
        <ul className="card tasks">
          <AnimatePresence initial={false}>
            {visible.map((t) => (
              <motion.li key={t.id} layout="position" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0, paddingBlock: 0, borderWidth: 0 }} transition={{ duration: 0.22 }} className={cx("task", !isOpen(t) && "is-closed")}>
                <button type="button" role="checkbox" aria-checked={t.status === "Done"} aria-label={`Mark "${t.title}" done`} className="task-check" data-status={t.status} onClick={() => toggleDone(t)}>
                  {t.status !== "Planned" && <StatusIcon status={t.status} size={14} />}
                </button>
                <div className="task-main">
                  <button type="button" className="row-link task-title" onClick={() => setEditing(t)}>{t.title}</button>
                  <div className="task-meta">
                    <AreaChip area={t.focusAreaId ? areaById.get(t.focusAreaId) : undefined} compact />
                    <PriorityMark priority={t.priority} />
                    {t.estimatedMinutes !== null && <span className="meta-mono">{formatDuration(t.estimatedMinutes)}</span>}
                    {t.impact === "High" && <span className="impact-tag is-high">High impact</span>}
                    {t.isOutside && <span className="outside-tag"><MapPin size={12} aria-hidden /> outside</span>}
                    {t.dueDate && <span className={cx("due", isOpen(t) && t.dueDate < todayISO() && "is-late")}>{isOpen(t) && t.dueDate < todayISO() ? "Overdue · " : "Due "}{formatDate(t.dueDate, "short")}</span>}
                    {t.scheduledDate && <span className="scheduled"><CalendarPlus size={12} aria-hidden /> {formatDate(t.scheduledDate, "medium")}</span>}
                    {t.status === "InProgress" && <span className="status-pill" data-status="InProgress"><StatusIcon status="InProgress" size={12} />In progress</span>}
                    {t.nextStep && <span className="task-next">Next: {t.nextStep}</span>}
                  </div>
                </div>
                <div className="task-actions">
                  {isOpen(t) && <Button size="sm" icon={<CalendarPlus size={15} aria-hidden />} onClick={() => setScheduling(t)}>Schedule</Button>}
                  <IconButton size="sm" label={`Edit ${t.title}`} onClick={() => setEditing(t)}><Pencil size={15} /></IconButton>
                  <IconButton size="sm" label={`Delete ${t.title}`} onClick={() => destroy(t)}><Trash2 size={15} /></IconButton>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <Dialog open={!!editing} onClose={() => setEditing(null)} title={editing === "new" ? "New task" : "Edit task"}>
        {editing && <TaskForm key={editing === "new" ? "new" : editing.id} task={editing === "new" ? null : editing} areas={areas.data ?? []} onClose={() => setEditing(null)} />}
      </Dialog>
      <Dialog open={!!scheduling} onClose={() => setScheduling(null)} title="Schedule this task" description={scheduling?.title}>
        {scheduling && <ScheduleForm key={scheduling.id} task={scheduling} onClose={() => setScheduling(null)} />}
      </Dialog>
    </>
  );
}

function TaskForm({ task, areas, onClose }: { task: Task | null; areas: Area[]; onClose: () => void }) {
  const { create, update } = useTaskMutations();
  const [form, setForm] = useState<TaskInput>(task ? toInput(task) : BLANK);
  const [error, setError] = useState<ApiError | null>(null);
  const patch = (p: Partial<TaskInput>) => setForm((f) => ({ ...f, ...p }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      if (task) await update.mutateAsync({ id: task.id, ...form });
      else await create.mutateAsync(form);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, errorMessage(err)));
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        {error && !error.field("title") && !error.field("estimatedMinutes") && <ErrorNote>{error.message}</ErrorNote>}
        <Field label="Task or outcome" error={error?.field("title")}>{(p) => <Input {...p} autoFocus required maxLength={200} value={form.title} onChange={(e) => patch({ title: e.target.value })} />}</Field>
        <Field label="Next step" optional hint="The first concrete action.">{(p) => <Input {...p} maxLength={200} placeholder="e.g. Compare the three quotes" value={form.nextStep} onChange={(e) => patch({ nextStep: e.target.value })} />}</Field>
        <div className="form-grid-2">
          <Field label="Focus area">{(p) => <AreaSelect {...p} areas={areas} value={form.focusAreaId} onChange={(focusAreaId) => patch({ focusAreaId })} />}</Field>
          <Field label="Estimate (minutes)" optional error={error?.field("estimatedMinutes")}>
            {(p) => <Input {...p} type="number" inputMode="numeric" min={5} max={1440} step={5} value={form.estimatedMinutes ?? ""} onChange={(e) => patch({ estimatedMinutes: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} />}
          </Field>
        </div>
        <div className="form-grid-2">
          <Field label="Due date" optional>{(p) => <Input {...p} type="date" value={form.dueDate ?? ""} onChange={(e) => patch({ dueDate: e.target.value || null })} />}</Field>
          <Field label="Status">{(p) => <Select {...p} value={form.status} onChange={(e) => patch({ status: e.target.value as TaskInput["status"] })}>{STATUSES.map((s) => <option key={s} value={s}>{statusLabel[s]}</option>)}</Select>}</Field>
        </div>
        <div className="form-grid-2">
          <Field label="Kind of work">{(p) => <Select {...p} value={form.workMode} onChange={(e) => patch({ workMode: e.target.value as WorkMode })}>{WORK_MODES.map((m) => <option key={m} value={m}>{modeLabel[m]}</option>)}</Select>}</Field>
          <div className="field">
            <span className="field-label">Priority</span>
            <Segmented label="Priority" value={form.priority} onChange={(priority) => patch({ priority })} options={PRIORITIES.map((v) => ({ value: v, label: v }))} />
          </div>
        </div>
        <div className="field">
          <span className="field-label">Outcome impact <span className="field-optional">how far does finishing this move you?</span></span>
          <Segmented label="Outcome impact" value={form.impact} onChange={(impact) => patch({ impact })} options={PRIORITIES.map((v) => ({ value: v, label: v }))} />
        </div>
        <OutsideToggle checked={form.isOutside} onChange={(isOutside) => patch({ isOutside })} />
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={create.isPending || update.isPending} disabled={!form.title.trim()}>{task ? "Save changes" : "Add task"}</Button>
      </footer>
    </form>
  );
}

function ScheduleForm({ task, onClose }: { task: Task; onClose: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { schedule } = useTaskMutations();
  // Outside work gets breathing room up front, because the physical world rarely runs to the minute.
  const length = (task.estimatedMinutes ?? 60) + (task.isOutside ? outsideBuffer(task.estimatedMinutes ?? 60) : 0);
  const [form, setForm] = useState({ date: todayISO(), start: "09:00", end: fromMinutes(9 * 60 + length), workMode: task.workMode });
  const [error, setError] = useState<string | null>(null);
  const planned = plannedMinutes(form.start, form.end);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await schedule.mutateAsync({ id: task.id, ...form });
      toast.success(`Booked for ${formatDate(form.date, "medium")}`, { label: "Open planner", run: () => navigate(`/planner?date=${form.date}`) });
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="form-grid-3">
          <Field label="Date">{(p) => <Input {...p} type="date" required autoFocus value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />}</Field>
          <Field label="Start">{(p) => <Input {...p} type="time" step={300} required value={form.start} onChange={(e) => setForm({ ...form, start: e.target.value, end: fromMinutes(toMinutes(e.target.value || "09:00") + (planned || length)) })} />}</Field>
          <Field label="End">{(p) => <Input {...p} type="time" step={300} required value={form.end} onChange={(e) => setForm({ ...form, end: e.target.value })} />}</Field>
        </div>
        <p className="duration-read" aria-live="polite">
          <strong>{formatDuration(planned)}</strong> planned{task.estimatedMinutes !== null && planned !== task.estimatedMinutes && <> · you estimated {formatDuration(task.estimatedMinutes)}{task.isOutside && ", plus a buffer because it is outside work"}</>}
        </p>
        <Field label="Work mode">{(p) => <Select {...p} value={form.workMode} onChange={(e) => setForm({ ...form, workMode: e.target.value as WorkMode })}>{WORK_MODES.map((m) => <option key={m} value={m}>{modeLabel[m]}</option>)}</Select>}</Field>
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" loading={schedule.isPending} disabled={!form.date || planned === 0}>Book the time</Button>
      </footer>
    </form>
  );
}
