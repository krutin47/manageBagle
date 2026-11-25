import { CornerDownLeft, Inbox, NotebookPen, Plus } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Link } from "react-router";
import { useToast } from "../../components/toast";
import { Button, Dialog, ErrorNote } from "../../components/ui";
import { errorMessage, type CaptureItem } from "../../lib/api";
import { useAreas, useBacklog, useCaptureTasks } from "../../lib/queries";
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

  const addTitles = (raw: string) => {
    const titles = raw.split(/\r?\n/).map((t) => t.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "").trim()).filter(Boolean);
    if (!titles.length) return;
    setRows((list) => titles.reduce((acc, title) => [...acc, newRow(crypto.randomUUID(), title.slice(0, 200), acc.at(-1))], list));
    setText("");
    input.current?.focus();
  };
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
          <form className="capture plan-capture" onSubmit={add}>
            <Plus size={18} aria-hidden />
            <input ref={input} autoFocus aria-label="What is on your mind?" placeholder="What is on your mind? Type it and press Enter…" maxLength={200} value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={(e) => {
                // A pasted list becomes one task per line (bullets and numbers removed).
                const pasted = e.clipboardData.getData("text");
                if (pasted.includes("\n")) { e.preventDefault(); addTitles(`${text}${pasted}`); }
              }} />
            <kbd aria-hidden><CornerDownLeft size={12} /> Enter</kbd>
          </form>
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
