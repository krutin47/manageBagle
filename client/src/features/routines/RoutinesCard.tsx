import { Bell, Coffee, Dumbbell, Lock, Moon, Pencil, Plus, Repeat, Trash2, Utensils, Briefcase } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { ColorPicker } from "../../components/ColorPicker";
import { useToast } from "../../components/toast";
import {
  Button,
  ConfirmDialog,
  cx,
  Dialog,
  ErrorNote,
  Field,
  IconButton,
  Input,
  Segmented,
  Select,
  Skeleton,
} from "../../components/ui";
import {
  ApiError,
  errorMessage,
  type Area,
  type AreaColor,
  type Preferences,
  type Routine,
  type RoutineInput,
  type TaskPolicy,
  type WeekdayFlag,
} from "../../lib/api";
import { useAreas, usePreferences, useRoutineMutations, useRoutines, useSavePreferences } from "../../lib/queries";
import { disablePush, enablePush, pushState, sendTestPush, type PushState } from "../../lib/push";
import { trimSeconds } from "../../lib/time";

const DAYS: { flag: WeekdayFlag; short: string }[] = [
  { flag: "Monday", short: "Mon" },
  { flag: "Tuesday", short: "Tue" },
  { flag: "Wednesday", short: "Wed" },
  { flag: "Thursday", short: "Thu" },
  { flag: "Friday", short: "Fri" },
  { flag: "Saturday", short: "Sat" },
  { flag: "Sunday", short: "Sun" },
];
const WORKDAYS: WeekdayFlag[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

/** The API sends combined flags such as "Workdays" or "Everyday"; expand them to single days. */
export function parseDays(days: string): WeekdayFlag[] {
  const parts = days.split(",").map((d) => d.trim());
  const set = new Set<WeekdayFlag>();
  for (const p of parts) {
    if (p === "Workdays") WORKDAYS.forEach((d) => set.add(d));
    else if (p === "Everyday") DAYS.forEach((d) => set.add(d.flag));
    else if (DAYS.some((d) => d.flag === p)) set.add(p as WeekdayFlag);
  }
  return DAYS.map((d) => d.flag).filter((d) => set.has(d));
}

export function describeDays(days: WeekdayFlag[]): string {
  if (days.length === 7) return "Every day";
  if (days.length === 5 && WORKDAYS.every((d) => days.includes(d))) return "Weekdays";
  if (days.length === 2 && days.includes("Saturday") && days.includes("Sunday")) return "Weekends";
  return days.map((d) => DAYS.find((x) => x.flag === d)!.short).join(", ");
}

const POLICY_LABEL: Record<TaskPolicy, string> = {
  NoTasks: "No tasks",
  AnyTask: "Any task",
  SelectedAreas: "Only some areas",
};

/** Ready-made starting points (P2-E3): one click opens the form filled in, to adjust and save. */
export function routineTemplates(areas: Area[]): { key: string; icon: ReactNode; input: RoutineInput }[] {
  // Work hours accept work-like focus areas when there are any; otherwise any task.
  const work = areas.filter((a) => /work|career|job|build|client|office/i.test(a.name)).map((a) => a.id);
  return [
    {
      key: "lunch",
      icon: <Utensils size={15} aria-hidden />,
      input: {
        title: "Lunch",
        days: WORKDAYS.join(", "),
        start: "12:30:00",
        end: "13:15:00",
        taskPolicy: "NoTasks",
        areaIds: [],
        isMeal: true,
        color: "orange",
      },
    },
    {
      key: "dinner",
      icon: <Utensils size={15} aria-hidden />,
      input: {
        title: "Dinner",
        days: DAYS.map((d) => d.flag).join(", "),
        start: "19:00:00",
        end: "19:45:00",
        taskPolicy: "NoTasks",
        areaIds: [],
        isMeal: true,
        color: "orange",
      },
    },
    {
      key: "workout",
      icon: <Dumbbell size={15} aria-hidden />,
      input: {
        title: "Workout",
        days: "Monday, Wednesday, Friday",
        start: "07:00:00",
        end: "08:00:00",
        taskPolicy: "NoTasks",
        areaIds: [],
        isMeal: false,
        color: "green",
      },
    },
    {
      key: "work",
      icon: <Briefcase size={15} aria-hidden />,
      input: {
        title: "Work hours",
        days: WORKDAYS.join(", "),
        start: "09:00:00",
        end: "17:00:00",
        taskPolicy: work.length ? "SelectedAreas" : "AnyTask",
        areaIds: work,
        isMeal: false,
        color: "blue",
      },
    },
    {
      key: "wind-down",
      icon: <Moon size={15} aria-hidden />,
      input: {
        title: "Wind-down",
        days: DAYS.map((d) => d.flag).join(", "),
        start: "21:30:00",
        end: "22:30:00",
        taskPolicy: "NoTasks",
        areaIds: [],
        isMeal: false,
        color: "violet",
      },
    },
  ];
}

export function RoutinesCard() {
  const routines = useRoutines();
  const areas = useAreas();
  const { remove } = useRoutineMutations();
  const toast = useToast();
  const [editing, setEditing] = useState<Routine | RoutineInput | "new" | null>(null);
  const existing = new Set((routines.data ?? []).map((r) => r.title.trim().toLowerCase()));
  const templates = routineTemplates(areas.data ?? []).filter((t) => !existing.has(t.input.title.toLowerCase()));
  const [deleting, setDeleting] = useState<Routine | null>(null);

  return (
    <section className="card" aria-labelledby="routines">
      <header className="card-head">
        <div>
          <h2 id="routines">Fixed schedule</h2>
          <p>
            Time that is already spoken for — meals, workouts, work hours. Planning starts around it, and you decide
            what may go inside.
          </p>
        </div>
        <Button icon={<Plus size={16} aria-hidden />} onClick={() => setEditing("new")}>
          Add routine
        </Button>
      </header>
      {templates.length > 0 && (
        <div className="routine-templates" role="group" aria-label="Start from a template">
          <span className="field-label">Start from</span>
          {templates.map((t) => (
            <button key={t.key} type="button" className="suggest-chip" onClick={() => setEditing(t.input)}>
              {t.icon} {t.input.title}
              <em>
                {trimSeconds(t.input.start)}–{trimSeconds(t.input.end)}
              </em>
            </button>
          ))}
        </div>
      )}
      {routines.isPending ? (
        <Skeleton height={80} radius={10} />
      ) : routines.isError ? (
        <ErrorNote onRetry={() => routines.refetch()}>We could not load your routines.</ErrorNote>
      ) : routines.data.length === 0 ? (
        <p className="muted">No routines yet. Start with lunch above: it is the one most often eaten by meetings.</p>
      ) : (
        <ul className="routine-list">
          {routines.data.map((r) => (
            <li key={r.id} data-area={r.color ?? "none"}>
              <span className="routine-icon" aria-hidden>
                {r.isMeal ? (
                  <Utensils size={16} />
                ) : r.taskPolicy === "NoTasks" ? (
                  <Lock size={16} />
                ) : (
                  <Repeat size={16} />
                )}
              </span>
              <div>
                <strong>{r.title}</strong>
                <span className="routine-meta">
                  {describeDays(parseDays(r.days))} · {trimSeconds(r.start)}–{trimSeconds(r.end)} ·{" "}
                  {r.taskPolicy === "SelectedAreas"
                    ? `only ${r.areaIds
                        .map((id) => areas.data?.find((a) => a.id === id)?.name)
                        .filter(Boolean)
                        .join(", ")}`
                    : POLICY_LABEL[r.taskPolicy].toLowerCase()}
                  {r.isMeal && " · meal reminder"}
                </span>
              </div>
              <IconButton size="sm" label={`Edit ${r.title}`} onClick={() => setEditing(r)}>
                <Pencil size={15} />
              </IconButton>
              <IconButton size="sm" label={`Delete ${r.title}`} onClick={() => setDeleting(r)}>
                <Trash2 size={15} />
              </IconButton>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={!!editing}
        onClose={() => setEditing(null)}
        title={editing === null || editing === "new" || !("id" in editing) ? "New routine" : "Edit routine"}
      >
        {editing && (
          <RoutineForm
            key={editing === "new" ? "new" : "id" in editing ? editing.id : editing.title}
            routine={editing === "new" ? null : editing}
            areas={areas.data ?? []}
            onClose={() => setEditing(null)}
          />
        )}
      </Dialog>
      <ConfirmDialog
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete “${deleting?.title}”?`}
        body="Planned blocks are not affected."
        confirmLabel="Delete routine"
        loading={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
            onError: (e) => toast.error(errorMessage(e)),
          })
        }
      />
    </section>
  );
}

/** `routine` is an existing routine to edit, a template to start from, or null for a blank one. */
function RoutineForm({
  routine,
  areas,
  onClose,
}: {
  routine: Routine | RoutineInput | null;
  areas: Area[];
  onClose: () => void;
}) {
  const saved = routine && "id" in routine ? routine : null;
  const { create, update } = useRoutineMutations();
  const [title, setTitle] = useState(routine?.title ?? "");
  const [days, setDays] = useState<WeekdayFlag[]>(routine ? parseDays(routine.days) : WORKDAYS);
  const [start, setStart] = useState(trimSeconds(routine?.start ?? "12:30"));
  const [end, setEnd] = useState(trimSeconds(routine?.end ?? "13:15"));
  const [policy, setPolicy] = useState<TaskPolicy>(routine?.taskPolicy ?? "NoTasks");
  const [areaIds, setAreaIds] = useState<string[]>(routine?.areaIds ?? []);
  const [isMeal, setIsMeal] = useState(routine?.isMeal ?? false);
  const [color, setColor] = useState<AreaColor | null>(routine?.color ?? null);
  const [error, setError] = useState<ApiError | null>(null);

  const toggleDay = (d: WeekdayFlag) =>
    setDays((list) => (list.includes(d) ? list.filter((x) => x !== d) : [...list, d]));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const body: RoutineInput = {
      title,
      days: days.join(", "),
      start: `${start}:00`,
      end: `${end}:00`,
      taskPolicy: policy,
      areaIds: policy === "SelectedAreas" ? areaIds : [],
      isMeal,
      color,
    };
    try {
      if (saved) await update.mutateAsync({ ...body, id: saved.id });
      else await create.mutateAsync(body);
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err : new ApiError(0, errorMessage(err)));
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      <div className="dialog-body form">
        {error && !error.field("title") && <ErrorNote>{error.message}</ErrorNote>}
        <Field label="Name" error={error?.field("title")}>
          {(p) => (
            <Input
              {...p}
              autoFocus
              required
              maxLength={80}
              placeholder="e.g. Lunch, Gym, Work hours"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          )}
        </Field>
        <div className="field">
          <span className="field-label">Repeats on</span>
          <div className="day-toggles" role="group" aria-label="Repeats on">
            {DAYS.map((d) => (
              <button
                key={d.flag}
                type="button"
                className={cx("day-toggle", days.includes(d.flag) && "is-on")}
                aria-pressed={days.includes(d.flag)}
                onClick={() => toggleDay(d.flag)}
              >
                {d.short}
              </button>
            ))}
          </div>
        </div>
        <div className="form-grid-2">
          <Field label="Starts">
            {(p) => (
              <Input {...p} type="time" step={300} required value={start} onChange={(e) => setStart(e.target.value)} />
            )}
          </Field>
          <Field label="Ends" hint={end <= start ? "Ends the next day" : undefined}>
            {(p) => (
              <Input {...p} type="time" step={300} required value={end} onChange={(e) => setEnd(e.target.value)} />
            )}
          </Field>
        </div>
        <div className="field">
          <span className="field-label">Can tasks be planned inside it?</span>
          <Segmented
            label="Can tasks be planned inside it?"
            value={policy}
            onChange={setPolicy}
            options={(["NoTasks", "AnyTask", "SelectedAreas"] as TaskPolicy[]).map((v) => ({
              value: v,
              label: POLICY_LABEL[v],
            }))}
          />
        </div>
        {policy === "SelectedAreas" && (
          <div className="field">
            <span className="field-label">Which focus areas?</span>
            <div className="area-pick" role="group" aria-label="Which focus areas">
              {areas.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className={cx("opt-chip is-tag", !areaIds.includes(a.id) && "is-off")}
                  data-area={a.color}
                  aria-pressed={areaIds.includes(a.id)}
                  onClick={() =>
                    setAreaIds((ids) => (ids.includes(a.id) ? ids.filter((x) => x !== a.id) : [...ids, a.id]))
                  }
                >
                  <span className="area-dot" aria-hidden />
                  {a.name}
                </button>
              ))}
            </div>
            {error?.field("areaIds") && (
              <p className="field-error" role="alert">
                {error.field("areaIds")}
              </p>
            )}
          </div>
        )}
        <div className="field">
          <span className="field-label">Colour on your calendar</span>
          <ColorPicker label="Colour on your calendar" noneLabel="Neutral" value={color} onChange={setColor} />
        </div>
        <label className="check">
          <input type="checkbox" checked={isMeal} onChange={(e) => setIsMeal(e.target.checked)} /> It is a meal — remind
          me when it starts
        </label>
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          loading={create.isPending || update.isPending}
          disabled={!title.trim() || days.length === 0}
        >
          {saved ? "Save routine" : "Add routine"}
        </Button>
      </footer>
    </form>
  );
}

const WATER: { value: string; label: string }[] = [
  { value: "off", label: "Off" },
  { value: "30", label: "Every 30 min" },
  { value: "45", label: "Every 45 min" },
  { value: "60", label: "Every hour" },
  { value: "90", label: "Every 90 min" },
  { value: "120", label: "Every 2 hours" },
];

/** The part of the day planning may use, and the water reminder (P2-C3, P2-C5). */
export function YourDayCard() {
  const prefs = usePreferences();
  return (
    <section className="card" aria-labelledby="your-day">
      <header className="card-head">
        <div>
          <h2 id="your-day">Your day and reminders</h2>
          <p>
            Automatic planning stays inside these hours. Reminders only appear during them; meal reminders come from
            routines marked as a meal.
          </p>
        </div>
      </header>
      {prefs.data ? (
        <YourDayForm key={JSON.stringify(prefs.data)} prefs={prefs.data} />
      ) : (
        <Skeleton height={80} radius={10} />
      )}
    </section>
  );
}

function YourDayForm({ prefs }: { prefs: Preferences }) {
  const toast = useToast();
  const save = useSavePreferences();
  const [form, setForm] = useState({
    dayStart: trimSeconds(prefs.dayStart),
    dayEnd: trimSeconds(prefs.dayEnd),
    water: prefs.waterReminderMinutes === null ? "off" : String(prefs.waterReminderMinutes),
  });
  const changed =
    form.dayStart !== trimSeconds(prefs.dayStart) ||
    form.dayEnd !== trimSeconds(prefs.dayEnd) ||
    form.water !== (prefs.waterReminderMinutes === null ? "off" : String(prefs.waterReminderMinutes));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    save.mutate(
      {
        dayStart: `${form.dayStart}:00`,
        dayEnd: `${form.dayEnd}:00`,
        waterReminderMinutes: form.water === "off" ? null : Number(form.water),
        breakColor: prefs.breakColor,
      },
      { onSuccess: () => toast.success("Saved"), onError: (err) => toast.error(errorMessage(err)) },
    );
  };
  return (
    <form className="form your-day" onSubmit={submit}>
      <div className="form-grid-3">
        <Field label="Day starts">
          {(p) => (
            <Input
              {...p}
              type="time"
              step={300}
              value={form.dayStart}
              onChange={(e) => setForm({ ...form, dayStart: e.target.value })}
            />
          )}
        </Field>
        <Field label="Day ends">
          {(p) => (
            <Input
              {...p}
              type="time"
              step={300}
              value={form.dayEnd}
              onChange={(e) => setForm({ ...form, dayEnd: e.target.value })}
            />
          )}
        </Field>
        <Field label="Drink water reminder">
          {(p) => (
            <Select {...p} value={form.water} onChange={(e) => setForm({ ...form, water: e.target.value })}>
              {WATER.map((w) => (
                <option key={w.value} value={w.value}>
                  {w.label}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <div className="your-day-foot">
        <Button
          type="submit"
          variant="primary"
          icon={<Coffee size={16} aria-hidden />}
          loading={save.isPending}
          disabled={!changed}
        >
          Save
        </Button>
        <NotificationPermission />
      </div>
    </form>
  );
}

const PUSH_TEXT: Record<PushState, string> = {
  unsupported: "This browser cannot show notifications while manageBagle is closed; reminders still appear in the app.",
  "needs-install":
    "On iPhone and iPad, add manageBagle to your Home Screen (Share → Add to Home Screen), open it from there, and turn notifications on.",
  blocked: "Notifications are blocked for this site in your browser settings; reminders still appear in the app.",
  off: "Get water, meal and time's-up reminders on this device even when manageBagle is closed.",
  on: "On for this device: reminders arrive even when manageBagle is closed.",
};

/** Reminders as notifications on this device, even with the app closed (P2-C5, ADR-019). */
function NotificationPermission() {
  const toast = useToast();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  if (state === null) return null;
  const run = async (action: () => Promise<PushState | void>, done?: string) => {
    setBusy(true);
    try {
      const next = await action();
      setState(next ?? (await pushState()));
      if (done) toast.success(done);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="push-control" role="group" aria-label="Notifications on this device">
      <p className="muted">
        <Bell size={14} aria-hidden /> {PUSH_TEXT[state]}
      </p>
      {state === "off" && (
        <Button
          icon={<Bell size={16} aria-hidden />}
          loading={busy}
          onClick={() => run(enablePush, "Notifications are on for this device")}
        >
          Turn on notifications
        </Button>
      )}
      {state === "on" && (
        <>
          <Button
            variant="ghost"
            loading={busy}
            onClick={() =>
              run(async () => {
                const r = await sendTestPush();
                toast.info(
                  r.sent > 0
                    ? "Test sent. It shows once the app is in the background."
                    : "Nothing could be sent to this device.",
                );
              })
            }
          >
            Send a test
          </Button>
          <Button
            variant="ghost"
            loading={busy}
            onClick={() =>
              run(async () => {
                await disablePush();
                return "off";
              }, "Notifications are off for this device")
            }
          >
            Turn off
          </Button>
        </>
      )}
    </div>
  );
}
