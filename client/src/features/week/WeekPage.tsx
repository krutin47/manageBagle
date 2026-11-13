import { CircleCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useToast } from "../../components/toast";
import { cx, DateNav, EmptyState, ErrorNote, PageHeader, Skeleton } from "../../components/ui";
import { errorMessage, type Area, type DaySummary, type Theme, type WeekSummary } from "../../lib/api";
import { useDocumentTitle } from "../../lib/hooks";
import { useAreas, useSaveTheme, useThemes, useWeekSummary } from "../../lib/queries";
import { formatDate, formatDuration, formatHours, formatWeekRange, isValidISODate, todayISO, weekStart } from "../../lib/time";
import { ChartNoAxesColumn } from "lucide-react";

const pct = (rate: number | null) => (rate === null ? "—" : `${Math.round(rate * 100)}%`);

export function WeekPage() {
  useDocumentTitle("Week");
  const [params, setParams] = useSearchParams();
  const start = weekStart(isValidISODate(params.get("date")) ? params.get("date")! : todayISO());
  const summary = useWeekSummary(start);
  const areas = useAreas();
  const s = summary.data?.start === start ? summary.data : undefined;

  return (
    <>
      <PageHeader
        eyebrow="Weekly HQ · the big picture"
        title={formatWeekRange(start)}
        actions={<DateNav label="Week" value={start} step={7} onChange={(d) => setParams({ date: d }, { replace: true })} />}
      />

      {summary.isError && <ErrorNote onRetry={() => summary.refetch()}>We could not load this week.</ErrorNote>}

      <section className="stat-row" aria-label="Week totals">
        <Kpi label="Planned" value={s && formatHours(s.totals.plannedMinutes)} unit="h" note={s ? `${s.totals.blocks} block${s.totals.blocks === 1 ? "" : "s"}` : undefined} />
        <Kpi label="Logged" value={s && formatHours(s.totals.loggedMinutes)} unit="h" note="only what you recorded" />
        <Kpi label="Deep focus" value={s && formatHours(s.totals.deepFocusMinutes)} unit="h" note={s && s.totals.plannedMinutes > 0 ? `${Math.round((s.totals.deepFocusMinutes / s.totals.plannedMinutes) * 100)}% of plan` : undefined} />
        <Kpi label="Blocks done" value={s && pct(s.totals.doneRate).replace("%", "")} unit={s?.totals.doneRate === null ? "" : "%"} note={s ? `${s.totals.blocksDone} of ${s.totals.blocks}` : undefined} />
      </section>

      <div className="week-grid">
        <section className="card" aria-labelledby="scorecard">
          <header className="card-head">
            <div>
              <h2 id="scorecard">Daily scorecard</h2>
              <p>The week in seven rows.</p>
            </div>
            <ul className="legend" aria-label="Legend">
              <li><i className="legend-plan" aria-hidden /> Planned</li>
              <li><i className="legend-log" aria-hidden /> Logged</li>
            </ul>
          </header>
          {s ? <Scorecard days={s.days} /> : <div className="stack">{Array.from({ length: 7 }, (_, i) => <Skeleton key={i} height={34} radius={8} />)}</div>}
        </section>

        <section className="card" aria-labelledby="by-area">
          <header className="card-head">
            <div>
              <h2 id="by-area">Time by life area</h2>
              <p>Is it going where you want?</p>
            </div>
          </header>
          {s ? <AreaBreakdown summary={s} areas={areas.data ?? []} /> : <div className="stack"><Skeleton height={34} /><Skeleton height={34} /><Skeleton height={34} /></div>}
        </section>
      </div>

      <ThemesCard />
    </>
  );
}

function Kpi({ label, value, unit, note }: { label: string; value?: string; unit?: string; note?: string }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <span className="stat-value">
        {value === undefined ? <Skeleton width={56} height={34} /> : (
          <motion.span key={value} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>{value}</motion.span>
        )}
        {value !== undefined && unit && <small>{unit}</small>}
      </span>
      {note && <span className="stat-note">{note}</span>}
    </div>
  );
}

function Scorecard({ days }: { days: DaySummary[] }) {
  const today = todayISO();
  const max = Math.max(60, ...days.flatMap((d) => [d.plannedMinutes, d.loggedMinutes]));
  return (
    <div className="table-wrap">
      <table className="table scorecard">
        <thead>
          <tr>
            <th>Day</th>
            <th className="bar-col"><span className="sr-only">Planned and logged, drawn to scale</span></th>
            <th className="num">Planned</th>
            <th className="num">Logged</th>
            <th className="num">Deep</th>
            <th className="num">Done</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d, i) => (
            <tr key={d.date} className={cx(d.date === today && "is-today")}>
              <th scope="row">
                <Link to={d.date === today ? "/" : `/?date=${d.date}`} className="row-link">
                  {formatDate(d.date, "weekdayShort")} <span className="muted">{formatDate(d.date, "day")}</span>
                </Link>
              </th>
              <td className="bar-col">
                <div className="pair-bars" title={`Planned ${formatDuration(d.plannedMinutes)} · Logged ${formatDuration(d.loggedMinutes)}`}>
                  <motion.i className="bar-plan" initial={{ width: 0 }} animate={{ width: `${(d.plannedMinutes / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.03, ease: [0.22, 1, 0.36, 1] }} />
                  <motion.i className="bar-log" initial={{ width: 0 }} animate={{ width: `${(d.loggedMinutes / max) * 100}%` }} transition={{ duration: 0.6, delay: 0.08 + i * 0.03, ease: [0.22, 1, 0.36, 1] }} />
                </div>
              </td>
              <td className="num mono">{d.blocks ? formatHours(d.plannedMinutes) + "h" : <span className="muted">—</span>}</td>
              <td className="num mono">{d.loggedMinutes ? formatHours(d.loggedMinutes) + "h" : <span className="muted">—</span>}</td>
              <td className="num mono">{d.deepFocusMinutes ? formatHours(d.deepFocusMinutes) + "h" : <span className="muted">—</span>}</td>
              <td className="num mono">{d.blocks ? `${d.blocksDone}/${d.blocks}` : <span className="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AreaBreakdown({ summary, areas }: { summary: WeekSummary; areas: Area[] }) {
  if (summary.areas.length === 0) {
    return <EmptyState icon={<ChartNoAxesColumn size={22} />} title="No time planned yet" body="Plan a few blocks and this shows where your week is really going." />;
  }
  const max = Math.max(...summary.areas.map((a) => Math.max(a.plannedMinutes, a.loggedMinutes)));
  return (
    <ul className="area-bars">
      {summary.areas.map((row, i) => {
        const area = areas.find((a) => a.id === row.focusAreaId);
        return (
          <li key={row.focusAreaId ?? "none"} data-area={area?.color ?? "none"}>
            <div className="area-bars-head">
              <span className="area-bars-name"><span className="area-dot" aria-hidden />{area?.name ?? "No focus area"}</span>
              <span className="mono">
                <strong>{formatHours(row.plannedMinutes)}h</strong>
                <span className="muted"> · {Math.round(row.shareOfPlan * 100)}%</span>
              </span>
            </div>
            <div className="area-track" title={`Planned ${formatDuration(row.plannedMinutes)} · Logged ${formatDuration(row.loggedMinutes)}`}>
              <motion.i className="area-fill" initial={{ width: 0 }} animate={{ width: `${(row.plannedMinutes / max) * 100}%` }} transition={{ duration: 0.6, delay: i * 0.04, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <span className="area-bars-sub">{row.loggedMinutes ? `${formatHours(row.loggedMinutes)}h logged` : "nothing logged yet"}</span>
          </li>
        );
      })}
    </ul>
  );
}

function ThemesCard() {
  const themes = useThemes();
  const [savedAt, setSavedAt] = useState(0);
  return (
    <section className="card" aria-labelledby="themes">
      <header className="card-head">
        <div>
          <h2 id="themes">Day themes</h2>
          <p>Give each day one job to reduce context switching. Edits save as you leave a field.</p>
        </div>
        <AnimatePresence>
          {savedAt > 0 && (
            <motion.span key={savedAt} className="saved" role="status" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <CircleCheck size={14} aria-hidden /> Saved
            </motion.span>
          )}
        </AnimatePresence>
      </header>
      {themes.isError ? <ErrorNote onRetry={() => themes.refetch()}>We could not load your themes.</ErrorNote> : (
        <div className="themes" role="table" aria-label="Day themes">
          <div className="themes-row themes-headrow" role="row">
            <span role="columnheader">Day</span>
            <span role="columnheader">Primary focus</span>
            <span role="columnheader">One meaningful outcome</span>
            <span role="columnheader">Review</span>
          </div>
          {(themes.data ?? []).map((t) => <ThemeRow key={t.day} theme={t} onSaved={() => setSavedAt(Date.now())} />)}
          {themes.isPending && <Skeleton height={220} radius={10} />}
        </div>
      )}
    </section>
  );
}

function ThemeRow({ theme, onSaved }: { theme: Theme; onSaved: () => void }) {
  const toast = useToast();
  const save = useSaveTheme();
  const [form, setForm] = useState(theme);
  const commit = () => {
    if (form.primaryFocus === theme.primaryFocus && form.outcome === theme.outcome && form.review === theme.review) return;
    save.mutate(form, { onSuccess: onSaved, onError: (e) => toast.error(errorMessage(e)) });
  };
  const cell = (key: "primaryFocus" | "outcome" | "review", label: string, max: number) => (
    <span role="cell">
      <input className="cell-input" aria-label={`${theme.day}: ${label}`} maxLength={max} value={form[key]} placeholder="—"
        onChange={(e) => setForm({ ...form, [key]: e.target.value })} onBlur={commit} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} />
    </span>
  );
  return (
    <div className="themes-row" role="row">
      <span role="rowheader" className="themes-day">{theme.day}</span>
      {cell("primaryFocus", "primary focus", 80)}
      {cell("outcome", "one meaningful outcome", 200)}
      {cell("review", "review", 500)}
    </div>
  );
}
