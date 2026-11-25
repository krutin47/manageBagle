import { CornerDownLeft, Inbox, Mic, NotebookPen, Plus, Sparkles, Square } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/toast";
import { Tip } from "../../components/OptionChip";
import { Button, cx, Dialog, ErrorNote, Segmented } from "../../components/ui";
import { errorMessage, type CaptureItem, type TaskSuggestion } from "../../lib/api";
import { useAiStatus, useAreas, useBacklog, useCaptureTasks, useSuggestTasks } from "../../lib/queries";
import { useDictation } from "../../lib/speech";
import { formatDuration, todayISO } from "../../lib/time";
import { newRow, priorityOf, similarTask, type Row, type SortMode } from "./rows";
import { TaskRows } from "./TaskRows";

/**
 * The brain dump (P2-E1): get everything out of your head and into the backlog. It does not plan
 * the day — that is Plan my day on Today — so it is reachable from every page.
 *
 * The unsaved list survives closing the dialog and reloading the tab (session storage, this device
 * only), so an accidental Escape never throws a dump away.
 */
const BrainDumpContext = createContext<{ open: () => void } | null>(null);
const DRAFT_KEY = "mb.brain-dump";

export function useBrainDump() {
  const context = useContext(BrainDumpContext);
  if (!context) throw new Error("useBrainDump must be used inside <BrainDumpProvider>");
  return context;
}

function readDraft(): Row[] {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    const rows = raw ? (JSON.parse(raw) as Row[]) : [];
    return Array.isArray(rows) ? rows.filter((r) => typeof r?.key === "string" && typeof r.title === "string") : [];
  } catch {
    return [];
  }
}

export function BrainDumpProvider({ children }: { children: ReactNode }) {
  const [isOpen, setOpen] = useState(false);
  const [rows, setRowsState] = useState<Row[]>(readDraft);
  const setRows = (update: (rows: Row[]) => Row[]) => setRowsState((list) => update(list));

  useEffect(() => {
    try {
      if (rows.length) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(rows));
      else sessionStorage.removeItem(DRAFT_KEY);
    } catch { /* storage blocked: the draft lives only in memory */ }
  }, [rows]);

  const value = useMemo(() => ({ open: () => setOpen(true) }), []);
  return (
    <BrainDumpContext.Provider value={value}>
      {children}
      <Dialog open={isOpen} onClose={() => setOpen(false)} title="Brain dump" description="Write down everything on your mind, one line each. It all goes to your backlog; plan your day when you are ready." width="xl">
        {isOpen && <Capture rows={rows} setRows={setRows} onClose={() => setOpen(false)} />}
      </Dialog>
    </BrainDumpContext.Provider>
  );
}

/** The button in the navigation, on every page. */
export function BrainDumpButton() {
  const { open } = useBrainDump();
  return (
    <button type="button" className="dump-launch" onClick={open} aria-label="Brain dump">
      <NotebookPen size={18} aria-hidden />
      <span>Brain dump</span>
    </button>
  );
}

function Capture({ rows, setRows, onClose }: { rows: Row[]; setRows: (update: (rows: Row[]) => Row[]) => void; onClose: () => void }) {
  const toast = useToast();
  const areas = useAreas();
  const backlog = useBacklog();
  const capture = useCaptureTasks();
  const [text, setText] = useState("");
  const [sort, setSort] = useState<SortMode>("written");
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const ai = useAiStatus();
  const suggest = useSuggestTasks();
  const [mode, setMode] = useState<"lines" | "free">("lines");
  const [paragraph, setParagraph] = useState("");
  const aiOn = ai.data?.enabled === true;
  const remaining = ai.data?.remainingToday ?? 0;

  const fromSuggestion = (s: TaskSuggestion, last: Row | undefined): Row => ({
    ...newRow(crypto.randomUUID(), s.title, last),
    minutes: s.estimatedMinutes ?? (s.workMode === "DeepFocus" ? 120 : 30), minutesChosen: s.estimatedMinutes !== null,
    focusAreaId: s.focusAreaId, workMode: s.workMode, impact: s.impact, dueDate: s.dueDate, isOutside: s.isOutside,
  });
  const turnIntoTasks = async () => {
    setError(null);
    try {
      const { tasks } = await suggest.mutateAsync(paragraph);
      if (tasks.length === 0) {
        toast.info("No tasks found in that text. Try naming the things you need to do.");
        return;
      }
      setRows((list) => tasks.reduce((acc, s) => [...acc, fromSuggestion(s, acc.at(-1))], list));
      setParagraph("");
      setMode("lines");
      toast.success(`${tasks.length} task${tasks.length === 1 ? "" : "s"} found. Check them, then save.`);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const addTitles = (raw: string) => {
    const titles = raw.split(/\r?\n/).map((t) => t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);
    if (!titles.length) return;
    setRows((list) => titles.reduce((acc, title) => [...acc, newRow(crypto.randomUUID(), title.slice(0, 200), acc.at(-1))], list));
    setText("");
    input.current?.focus();
  };
  // Speaking adds a line per phrase, or continues the paragraph when writing freely.
  const dictation = useDictation(
    (phrase) => (mode === "free" ? setParagraph((p) => `${p}${p && !p.endsWith(" ") ? " " : ""}${phrase}`) : addTitles(phrase)),
    (reason) => setError(reason),
  );
  const add = (e: FormEvent) => {
    e.preventDefault();
    addTitles(text);
  };

  const save = async () => {
    setError(null);
    const today = todayISO();
    const items: CaptureItem[] = rows.map((r) => ({
      title: r.title.trim(), estimatedMinutes: r.minutes, focusAreaId: r.focusAreaId, workMode: r.workMode, isOutside: r.isOutside,
      priority: priorityOf(r, today), impact: r.impact, dueDate: r.dueDate, breakMinutes: r.breakMinutes,
    }));
    try {
      const saved = await capture.mutateAsync(items);
      setRows(() => []);
      toast.success(`${saved.length} task${saved.length === 1 ? "" : "s"} added to your backlog`);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const total = rows.reduce((s, r) => s + r.minutes, 0);
  const existing = backlog.data ?? [];
  return (
    <>
      <div className="dialog-body plan-body">
        <div className="plan-step">
          {error && <ErrorNote>{error}</ErrorNote>}
          {aiOn && (
            <Segmented size="sm" label="How to write" value={mode} onChange={setMode}
              options={[{ value: "lines", label: "One per line" }, { value: "free", label: "Write freely" }]} />
          )}
          {mode === "free" && aiOn ? (
            <div className="dump-free">
              <textarea className="input dump-free-text" aria-label="Write everything on your mind" rows={5} maxLength={4000} value={paragraph}
                onChange={(e) => setParagraph(e.target.value)}
                placeholder="Write it the way you would say it: “Call the bank before Friday, the deck for Monday is the big one, and I should book the dentist…”" />
              <div className="dump-free-actions">
                {dictation.supported && <MicButton listening={dictation.listening} onStart={dictation.start} onStop={dictation.stop} />}
                <span className="dump-free-note">Sent to Anthropic’s Claude to suggest tasks; nothing is saved until you choose. {remaining} left today.</span>
                <Button variant="primary" icon={<Sparkles size={16} aria-hidden />} loading={suggest.isPending} disabled={!paragraph.trim() || remaining === 0} onClick={turnIntoTasks}>
                  Turn into tasks
                </Button>
              </div>
            </div>
          ) : (
          <form className="capture plan-capture" onSubmit={add}>
            <Plus size={18} aria-hidden />
            <input ref={input} autoFocus aria-label="What is on your mind?" placeholder="What is on your mind? Type it and press Enter…" maxLength={200} value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                // A pasted list becomes one task per line (bullets and numbers removed).
                const pasted = e.clipboardData.getData("text");
                if (pasted.includes("\n")) { e.preventDefault(); addTitles(`${text}${pasted}`); }
              }} />
            {dictation.supported && <MicButton listening={dictation.listening} onStart={dictation.start} onStop={dictation.stop} />}
            <kbd aria-hidden><CornerDownLeft size={12} /> Enter</kbd>
          </form>
          )}
          {rows.length === 0 ? (
            <p className="plan-hint">No sorting, no judging, no planning yet — just get it out of your head. Add details if they come to mind; you can change them later in the backlog.</p>
          ) : (
            <TaskRows rows={rows} setRows={setRows} areas={areas.data ?? []} sort={sort} onSort={setSort}
              note={(r) => {
                const twin = similarTask(r.title, existing);
                return twin ? <span className="dump-twin"><Inbox size={13} aria-hidden /> Looks like “{twin.title}”, already in your backlog</span> : null;
              }} />
          )}
        </div>
      </div>
      <footer className="dialog-foot plan-foot">
        <span className="plan-total push-left" aria-live="polite">
          {rows.length === 0 ? <Link to="/backlog" onClick={onClose}>Open backlog</Link> : <><strong>{rows.length}</strong> task{rows.length === 1 ? "" : "s"} · <strong>{formatDuration(total)}</strong></>}
        </span>
        {rows.length > 0 && <Button variant="ghost" onClick={() => setRows(() => [])}>Clear</Button>}
        <Button onClick={onClose}>{rows.length ? "Keep for later" : "Close"}</Button>
        <Button variant="primary" loading={capture.isPending} disabled={rows.length === 0 || rows.some((r) => !r.title.trim())} onClick={save}>
          Save to backlog
        </Button>
      </footer>
    </>
  );
}

/** Speak instead of typing (P3-AI2). */
function MicButton({ listening, onStart, onStop }: { listening: boolean; onStart: () => void; onStop: () => void }) {
  return (
    <Tip content={listening ? "Listening… press to stop." : "Speak instead of typing. Uses your browser’s speech recognition."}>
      <button type="button" className={cx("mic-btn", listening && "is-listening")} aria-pressed={listening} aria-label={listening ? "Stop listening" : "Speak instead of typing"}
        onClick={listening ? onStop : onStart}>
        {listening ? <Square size={14} aria-hidden /> : <Mic size={16} aria-hidden />}
      </button>
    </Tip>
  );
}
