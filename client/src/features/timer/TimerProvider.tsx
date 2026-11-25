import { CheckCircle2, Clock3, Pause, Play, Square, Trash2 } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useToast } from "../../components/toast";
import { Button, cx, Dialog, ErrorNote, Field, IconButton, Textarea } from "../../components/ui";
import { ConflictError, errorMessage, type Block, type StopOutcome } from "../../lib/api";
import { askForNotificationsOnce, notifyInBackground } from "../../lib/notify";
import { useRunningTimer, useTimerMutations } from "../../lib/queries";
import { formatDuration } from "../../lib/time";
import { dueSeconds, elapsedSeconds, formatClock } from "./clock";

interface TimerApi {
  running: Block | null;
  start: (block: Block) => void;
  pause: (block: Block) => void;
  askToStop: (block: Block) => void;
  busy: boolean;
}

const TimerContext = createContext<TimerApi | null>(null);

export function useFocusTimer(): TimerApi {
  const ctx = useContext(TimerContext);
  if (!ctx) throw new Error("useFocusTimer must be used inside TimerProvider");
  return ctx;
}

/** Re-renders every second while `active`, so elapsed times tick. */
export function useTick(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [active]);
  return now;
}

/**
 * Owns the focus timer for the whole app (P2-B): the running block, the dialogs it needs (switch,
 * time's up, stop), and the "now playing" bar. Any screen can start, pause or stop through
 * {@link useFocusTimer}.
 */
export function TimerProvider({ children }: { children: ReactNode }) {
  const toast = useToast();
  const { data: running = null } = useRunningTimer();
  const { start, pause, extend, stop } = useTimerMutations();
  const [switchTo, setSwitchTo] = useState<{ block: Block; runningTitle: string } | null>(null);
  const [stopping, setStopping] = useState<Block | null>(null);
  const [timeUp, setTimeUp] = useState<Block | null>(null);
  const prompted = useRef(new Set<string>());

  const begin = useCallback((block: Block, pauseRunning = false) => {
    void askForNotificationsOnce();
    start.mutate({ blockId: block.id, pauseRunning }, {
      onSuccess: () => setSwitchTo(null),
      onError: (e) => {
        if (e instanceof ConflictError && e.code === "timer_already_running") {
          setSwitchTo({ block, runningTitle: running?.title ?? "Another block" });
        } else {
          toast.error(errorMessage(e));
        }
      },
    });
  }, [start, running, toast]);

  const api = useMemo<TimerApi>(() => ({
    running,
    start: (b) => begin(b),
    pause: (b) => pause.mutate(b.id, { onError: (e) => toast.error(errorMessage(e)) }),
    askToStop: setStopping,
    busy: start.isPending || pause.isPending || stop.isPending,
  }), [running, begin, pause, toast, start.isPending, stop.isPending]);

  // Time's up (P2-B4): ask once per threshold; an extension moves the threshold.
  const now = useTick(!!running);
  useEffect(() => {
    if (!running) return;
    const due = dueSeconds(running);
    const marker = `${running.id}:${due}`;
    if (elapsedSeconds(running, now) < due || prompted.current.has(marker)) return;
    prompted.current.add(marker);
    setTimeUp(running);
    notifyInBackground("Time's up", `${running.title} — need more time?`, `time-up-${running.id}`);
  }, [running, now]);

  const grant = (minutes: number) => {
    if (!timeUp) return;
    extend.mutate({ blockId: timeUp.id, minutes }, {
      onSuccess: () => toast.success(`${formatDuration(minutes)} added to ${timeUp.title}`),
      onError: (e) => toast.error(errorMessage(e)),
    });
    setTimeUp(null);
  };

  return (
    <TimerContext.Provider value={api}>
      {children}
      <NowPlaying block={running} now={now} onPause={api.pause} onStop={setStopping} />

      <Dialog open={!!switchTo} onClose={() => setSwitchTo(null)} width="sm" title="Switch what you are working on?"
        description={switchTo ? `“${switchTo.runningTitle}” is running. Only one block can be timed at a time.` : undefined}>
        <footer className="dialog-foot">
          <Button onClick={() => setSwitchTo(null)}>Keep it running</Button>
          <Button variant="primary" loading={start.isPending} onClick={() => switchTo && begin(switchTo.block, true)}>
            Pause it and start “{switchTo?.block.title}”
          </Button>
        </footer>
      </Dialog>

      <Dialog open={!!timeUp} onClose={() => setTimeUp(null)} width="sm" title="Time's up"
        description={timeUp ? `You planned ${formatDuration(timeUp.plannedMinutes + timeUp.extendedMinutes)} for “${timeUp.title}”. Need more time?` : undefined}>
        <div className="dialog-body time-up-choices">
          {[15, 30].map((m) => <Button key={m} size="lg" icon={<Clock3 size={18} aria-hidden />} onClick={() => grant(m)}>+{m} min</Button>)}
          <Button size="lg" variant="primary" icon={<CheckCircle2 size={18} aria-hidden />} onClick={() => {
            if (!timeUp) return;
            stop.mutate({ blockId: timeUp.id, outcome: "Finished" }, { onSuccess: () => toast.success("Nice work. Time recorded."), onError: (e) => toast.error(errorMessage(e)) });
            setTimeUp(null);
          }}>I'm done</Button>
        </div>
      </Dialog>

      <StopDialog block={stopping} onClose={() => setStopping(null)} onStop={async (outcome, note) => {
        await stop.mutateAsync({ blockId: stopping!.id, outcome, note });
        toast.success(outcome === "Finished" ? "Done. Time recorded." : outcome === "Later" ? "Moved back to your backlog for another time." : "Dropped.");
        setStopping(null);
      }} />
    </TimerContext.Provider>
  );
}

/** Always visible while a timer runs, on every page. */
function NowPlaying({ block, now, onPause, onStop }: { block: Block | null; now: number; onPause: (b: Block) => void; onStop: (b: Block) => void }) {
  return (
    <AnimatePresence>
      {block && (
        <motion.div className="now-playing" role="region" aria-label="Focus timer" initial={{ y: 24, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 24, opacity: 0 }}
          transition={{ type: "spring", stiffness: 420, damping: 34 }}>
          <span className="now-playing-dot" aria-hidden />
          <span className="now-playing-title">{block.title}</span>
          <span className={cx("now-playing-clock", elapsedSeconds(block, now) >= dueSeconds(block) && "is-over")} aria-live="off">
            {formatClock(elapsedSeconds(block, now))}<small> / {formatDuration(block.plannedMinutes + block.extendedMinutes)}</small>
          </span>
          <IconButton size="sm" label={`Pause ${block.title}`} onClick={() => onPause(block)}><Pause size={16} /></IconButton>
          <IconButton size="sm" label={`Stop ${block.title}`} onClick={() => onStop(block)}><Square size={14} /></IconButton>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

const STOP_CHOICES: { value: StopOutcome; title: string; body: string; icon: ReactNode }[] = [
  { value: "Finished", title: "I finished it", body: "Mark it done and keep the time worked.", icon: <CheckCircle2 size={18} aria-hidden /> },
  { value: "Later", title: "Not finished — another time", body: "Keep the time worked and put the task back in your backlog.", icon: <Clock3 size={18} aria-hidden /> },
  { value: "Drop", title: "Drop it", body: "It is not happening. You can say why.", icon: <Trash2 size={18} aria-hidden /> },
];

function StopDialog({ block, onClose, onStop }: { block: Block | null; onClose: () => void; onStop: (outcome: StopOutcome, note?: string) => Promise<void> }) {
  return (
    <Dialog open={!!block} onClose={onClose} width="sm" title="Stop the timer" description={block ? `How did “${block.title}” go?` : undefined}>
      {block && <StopForm key={block.id} onClose={onClose} onStop={onStop} />}
    </Dialog>
  );
}

function StopForm({ onClose, onStop }: { onClose: () => void; onStop: (outcome: StopOutcome, note?: string) => Promise<void> }) {
  const [outcome, setOutcome] = useState<StopOutcome>("Finished");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await onStop(outcome, outcome === "Finished" ? undefined : note.trim() || undefined);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
    }
  };
  return (
    <>
      <div className="dialog-body form">
        {error && <ErrorNote>{error}</ErrorNote>}
        <div className="stop-choices" role="radiogroup" aria-label="How did it go?">
          {STOP_CHOICES.map((c) => (
            <label key={c.value} className={cx("stop-choice", outcome === c.value && "is-on")} data-choice={c.value}>
              <input type="radio" name="stop" value={c.value} checked={outcome === c.value} onChange={() => setOutcome(c.value)} />
              {c.icon}
              <span><strong>{c.title}</strong><small>{c.body}</small></span>
            </label>
          ))}
        </div>
        {outcome !== "Finished" && (
          <Field label={outcome === "Drop" ? "Why are you dropping it?" : "Anything to remember for next time?"} optional>
            {(p) => <Textarea {...p} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder={outcome === "Drop" ? "e.g. No longer needed after Monday's call" : "e.g. Waiting on feedback from Sam"} />}
          </Field>
        )}
      </div>
      <footer className="dialog-foot">
        <Button onClick={onClose}>Keep timing</Button>
        <Button variant={outcome === "Drop" ? "danger" : "primary"} loading={busy} onClick={submit}>
          {outcome === "Finished" ? "Mark done" : outcome === "Later" ? "Save for later" : "Drop it"}
        </Button>
      </footer>
    </>
  );
}

/** Play / pause for one block, with its elapsed time when it has any. */
export function TimerButton({ block }: { block: Block }) {
  const timer = useFocusTimer();
  const isRunning = timer.running?.id === block.id && !!block.timerStartedAt;
  const now = useTick(isRunning);
  const closed = block.status === "Done" || block.status === "Skipped";
  const elapsed = elapsedSeconds(isRunning ? timer.running! : block, now);
  if (closed) return null;
  return (
    <span className={cx("timer-btn-wrap", isRunning && "is-running")}>
      {(isRunning || block.trackedSeconds > 0) && (
        <span className={cx("timer-elapsed", elapsed >= dueSeconds(block) && "is-over")}>{formatClock(elapsed)}</span>
      )}
      <button type="button" className={cx("timer-btn", isRunning && "is-running")} disabled={timer.busy}
        aria-label={isRunning ? `Pause ${block.title}` : `${block.trackedSeconds > 0 ? "Resume" : "Start"} timer for ${block.title}`}
        onClick={() => (isRunning ? timer.pause(timer.running!) : timer.start(block))}>
        {isRunning ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
      </button>
      {(isRunning || block.trackedSeconds > 0) && (
        <IconButton size="sm" label={`Stop ${block.title}`} onClick={() => timer.askToStop(isRunning ? timer.running! : block)}><Square size={13} /></IconButton>
      )}
    </span>
  );
}
