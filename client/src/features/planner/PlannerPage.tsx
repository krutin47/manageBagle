import { CalendarPlus, MoonStar, Plus } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useSearchParams } from "react-router";
import { AreaChip, Button, cx, DateNav, EmptyState, ErrorNote, PageHeader, PriorityMark, Segmented, StatusIcon, StatusPill } from "../../components/ui";
import type { Area, Block } from "../../lib/api";
import { useDocumentTitle, useMediaQuery, useNowMinutes } from "../../lib/hooks";
import { modeLabel, statusLabel } from "../../lib/labels";
import { useAreas, useWeekBlocks } from "../../lib/queries";
import { formatDate, formatDuration, formatTime, formatVariance, formatWeekRange, fromMinutes, isValidISODate, snap, todayISO, weekDays, weekStart } from "../../lib/time";
import { BlockDialog, type BlockDraft } from "./BlockDialog";
import { placeBlocks } from "./layout";

const HOUR = 56; // px per hour
const HOURS = Array.from({ length: 24 }, (_, i) => i);

export function PlannerPage() {
  useDocumentTitle("Planner");
  const [params, setParams] = useSearchParams();
  const date = isValidISODate(params.get("date")) ? params.get("date")! : todayISO();
  const view = params.get("view") === "list" ? "list" : "calendar";
  const start = weekStart(date);
  const narrow = useMediaQuery("(max-width: 860px)");

  const areas = useAreas();
  const blocks = useWeekBlocks(date);
  const [draft, setDraft] = useState<BlockDraft | null>(null);

  const setParam = (next: Record<string, string>) => setParams({ date, view, ...next }, { replace: true });
  const newBlock = (d = date, startMin = defaultStart(d)) => setDraft({ date: d, start: fromMinutes(startMin), end: fromMinutes(startMin + 60) });

  const areaById = useMemo(() => new Map((areas.data ?? []).map((a) => [a.id, a])), [areas.data]);
  const days = narrow ? [date] : weekDays(start);

  return (
    <>
      <PageHeader
        eyebrow="Plan vs. reality"
        title={formatWeekRange(start)}
        actions={
          <>
            <Segmented label="View" size="sm" value={view} onChange={(v) => setParam({ view: v })} options={[{ value: "calendar", label: "Calendar" }, { value: "list", label: "List" }]} />
            <DateNav label="Week" value={date} step={narrow && view === "calendar" ? 1 : 7} onChange={(d) => setParam({ date: d })} />
            <Button variant="primary" icon={<Plus size={18} aria-hidden />} onClick={() => newBlock()}>
              New block
            </Button>
          </>
        }
      />

      {blocks.isError && <ErrorNote onRetry={() => blocks.refetch()}>We could not load your blocks.</ErrorNote>}

      {view === "calendar" ? (
        <>
          {narrow && <DayStrip days={weekDays(start)} selected={date} blocks={blocks.data ?? []} onSelect={(d) => setParam({ date: d })} />}
          <WeekGrid days={days} blocks={blocks.data ?? []} loading={blocks.isPending} areaById={areaById} onCreate={newBlock} onOpen={(b) => setDraft(b)} />
        </>
      ) : (
        <BlockTable blocks={blocks.data ?? []} loading={blocks.isPending} areaById={areaById} onOpen={(b) => setDraft(b)} onCreate={() => newBlock()} />
      )}

      <BlockDialog draft={draft} areas={areas.data ?? []} onClose={() => setDraft(null)} />
    </>
  );
}

/** Next half hour if planning today, otherwise 09:00. */
function defaultStart(date: string) {
  if (date !== todayISO()) return 9 * 60;
  const now = new Date();
  return Math.min(snap(now.getHours() * 60 + now.getMinutes() + 15, 30), 23 * 60);
}

function DayStrip({ days, selected, blocks, onSelect }: { days: string[]; selected: string; blocks: Block[]; onSelect: (d: string) => void }) {
  const today = todayISO();
  return (
    <div className="day-strip" role="tablist" aria-label="Day">
      {days.map((d) => (
        <button key={d} role="tab" type="button" aria-selected={d === selected} className={cx("day-strip-item", d === today && "is-today")} onClick={() => onSelect(d)}>
          <span>{formatDate(d, "weekdayShort")}</span>
          <strong>{formatDate(d, "day")}</strong>
          <i className={blocks.some((b) => b.date === d) ? "has" : undefined} aria-hidden />
        </button>
      ))}
    </div>
  );
}

interface GridProps {
  days: string[];
  blocks: Block[];
  loading: boolean;
  areaById: Map<string, Area>;
  onCreate: (date: string, startMin: number) => void;
  onOpen: (block: Block) => void;
}

function WeekGrid({ days, blocks, loading, areaById, onCreate, onOpen }: GridProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const now = useNowMinutes();
  const today = todayISO();
  const firstDay = days[0];

  // Open on the working day (or the first block if it starts earlier), not at midnight.
  const earliest = blocks.length ? Math.min(...blocks.filter((b) => days.includes(b.date)).map((b) => Number(b.start.slice(0, 2))), 7) : 7;
  useEffect(() => {
    scroller.current?.scrollTo({ top: Math.max(0, earliest * HOUR - 12) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstDay, loading]);

  const createAt = (date: string) => (e: MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top;
    onCreate(date, Math.min(snap((y / HOUR) * 60 - 7, 15), 23 * 60));
  };

  return (
    <section className="cal" aria-label="Week calendar" style={{ "--cols": days.length, "--hour": `${HOUR}px` } as React.CSSProperties}>
      <div className="cal-head">
        <span className="cal-gutter" />
        {days.map((d) => {
          const dayBlocks = blocks.filter((b) => b.date === d);
          const planned = dayBlocks.reduce((sum, b) => sum + b.plannedMinutes, 0);
          return (
            <div key={d} className={cx("cal-day-head", d === today && "is-today")}>
              <span className="cal-dow">{formatDate(d, "weekdayShort")}</span>
              <span className="cal-dom">{formatDate(d, "day")}</span>
              <span className="cal-load">{planned ? formatDuration(planned) : "—"}</span>
            </div>
          );
        })}
      </div>

      <div className="cal-scroll" ref={scroller} tabIndex={0} aria-label="Hours of the day, scrollable">
        <div className="cal-body">
          <div className="cal-gutter cal-hours" aria-hidden>
            {HOURS.map((h) => (
              <span key={h} style={{ top: h * HOUR }}>
                {h === 0 ? "" : `${String(h).padStart(2, "0")}:00`}
              </span>
            ))}
          </div>
          {days.map((d) => (
            <div key={d} className={cx("cal-col", d === today && "is-today")} onClick={createAt(d)} title="Click an empty slot to add a block">
              {d === today && (
                <div className="now-line" style={{ top: (now / 60) * HOUR }} aria-hidden>
                  <span />
                </div>
              )}
              {placeBlocks(blocks.filter((b) => b.date === d)).map((p) => {
                const area = p.block.focusAreaId ? areaById.get(p.block.focusAreaId) : undefined;
                const height = Math.max(((p.endMin - p.startMin) / 60) * HOUR - 2, 20);
                return (
                  <motion.button
                    key={p.block.id}
                    type="button"
                    layout="position"
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.2 }}
                    className={cx("cal-block", height < 40 && "is-short")}
                    data-area={area?.color ?? "none"}
                    data-status={p.block.status}
                    style={{ top: (p.startMin / 60) * HOUR + 1, height, left: `calc(${(p.lane / p.lanes) * 100}% + 2px)`, width: `calc(${100 / p.lanes}% - 4px)` }}
                    onClick={() => onOpen(p.block)}
                    aria-label={`${p.block.title}, ${formatTime(p.block.start)} to ${formatTime(p.block.end)}, ${area?.name ?? "no focus area"}, ${statusLabel[p.block.status]}`}
                  >
                    <span className="cal-block-title">
                      {p.block.status !== "Planned" && <StatusIcon status={p.block.status} size={12} />}
                      {p.block.title}
                    </span>
                    <span className="cal-block-time">
                      {p.block.start.slice(0, 5)}–{p.block.end.slice(0, 5)}
                      {p.overnight && <MoonStar size={11} aria-label="continues past midnight" />}
                    </span>
                  </motion.button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BlockTable({ blocks, loading, areaById, onOpen, onCreate }: { blocks: Block[]; loading: boolean; areaById: Map<string, Area>; onOpen: (b: Block) => void; onCreate: () => void }) {
  if (!loading && blocks.length === 0) {
    return (
      <div className="card">
        <EmptyState icon={<CalendarPlus size={22} />} title="Nothing planned this week" body="Make an appointment with your own priorities. Start with one deep-focus block." action={<Button variant="primary" onClick={onCreate}>Plan a block</Button>} />
      </div>
    );
  }
  return (
    <div className="card table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Date</th>
            <th>Time</th>
            <th>Task / outcome</th>
            <th>Focus area</th>
            <th>Priority</th>
            <th>Mode</th>
            <th>Status</th>
            <th className="num">Planned</th>
            <th className="num">Actual</th>
            <th className="num">+/−</th>
          </tr>
        </thead>
        <tbody>
          {blocks.map((b) => (
            <tr key={b.id} data-status={b.status}>
              <td className="nowrap">{formatDate(b.date, "medium")}</td>
              <td className="mono nowrap">{b.start.slice(0, 5)}–{b.end.slice(0, 5)}</td>
              <td className="table-main">
                <button type="button" className="row-link" onClick={() => onOpen(b)}>
                  {b.title}
                </button>
                {b.notes && <span className="table-note">{b.notes}</span>}
              </td>
              <td><AreaChip area={b.focusAreaId ? areaById.get(b.focusAreaId) : undefined} /></td>
              <td><PriorityMark priority={b.priority} /></td>
              <td className="nowrap">{modeLabel[b.workMode]}</td>
              <td><StatusPill status={b.status} /></td>
              <td className="num mono">{formatDuration(b.plannedMinutes)}</td>
              <td className="num mono">{b.actualMinutes === null ? <span className="muted">—</span> : formatDuration(b.actualMinutes)}</td>
              <td className="num mono"><Variance minutes={b.varianceMinutes} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Variance({ minutes }: { minutes: number | null }) {
  if (minutes === null) return <span className="muted">—</span>;
  return <span className={cx("variance", minutes > 0 ? "is-over" : "is-under")}>{formatVariance(minutes)}</span>;
}
