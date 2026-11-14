import { CircleCheck } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useToast } from "../../components/toast";
import { DateNav, ErrorNote, Field, Input, PageHeader, Skeleton, Textarea } from "../../components/ui";
import { errorMessage, type Review } from "../../lib/api";
import { useDocumentTitle } from "../../lib/hooks";
import { useDay, useDayMutations, useWeekBlocks } from "../../lib/queries";
import { formatDate, formatDuration, formatHours, isValidISODate, todayISO } from "../../lib/time";

const PROMPTS: { key: keyof Review; label: string; placeholder: string }[] = [
  { key: "biggestWin", label: "Biggest win", placeholder: "What moved forward today?" },
  { key: "interruptions", label: "What interrupted me?", placeholder: "Name it without judging it." },
  { key: "changeTomorrow", label: "What will I change tomorrow?", placeholder: "One small adjustment." },
];

export function ReviewPage() {
  useDocumentTitle("Review");
  const [params, setParams] = useSearchParams();
  const date = isValidISODate(params.get("date")) ? params.get("date")! : todayISO();
  const day = useDay(date);
  const week = useWeekBlocks(date);
  const blocks = useMemo(() => (week.data ?? []).filter((b) => b.date === date), [week.data, date]);

  const planned = blocks.reduce((s, b) => s + b.plannedMinutes, 0);
  const logged = blocks.reduce((s, b) => s + (b.actualMinutes ?? 0), 0);
  const done = blocks.filter((b) => b.status === "Done").length;
  const overran = blocks.filter((b) => (b.varianceMinutes ?? 0) > 0).sort((a, b) => b.varianceMinutes! - a.varianceMinutes!);
  const outcomes = day.data?.outcomes ?? [];

  return (
    <>
      <PageHeader
        eyebrow="End-of-day review · optional, five minutes"
        title={formatDate(date, "long")}
        sub="Be honest, not perfect. The point is one small adjustment for tomorrow."
        actions={
          <DateNav label="Day" value={date} step={1} onChange={(d) => setParams(d === todayISO() ? {} : { date: d }, { replace: true })}>
            <Input type="date" className="date-jump" aria-label="Jump to date" value={date} onChange={(e) => e.target.value && setParams({ date: e.target.value }, { replace: true })} />
          </DateNav>
        }
      />

      <section className="card" aria-labelledby="how-it-went">
        <header className="card-head">
          <div>
            <h2 id="how-it-went">How the day went</h2>
            <p>
              {blocks.length === 0
                ? "Nothing was planned for this day."
                : <>{done} of {blocks.length} blocks done · {formatHours(planned)}h planned · {formatHours(logged)}h logged</>}
            </p>
          </div>
          <Link to={date === todayISO() ? "/" : `/?date=${date}`}>Open this day</Link>
        </header>
        <div className="review-facts">
          <div>
            <h3>Top three</h3>
            {day.isPending ? <Skeleton height={60} /> : outcomes.length === 0 ? <p className="muted">None were chosen.</p> : (
              <ul className="fact-list">
                {outcomes.map((o) => (
                  <li key={o.rank} className={o.status === "Done" ? "is-done" : undefined}>
                    <b className="rank-badge">{o.rank}</b>
                    <span>{o.result}</span>
                    <em>{o.status === "Done" ? "done" : "not finished"}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <h3>Ran over</h3>
            {overran.length === 0 ? <p className="muted">{logged > 0 ? "Nothing ran over what you planned." : "Log actual minutes on Today to see what ran over."}</p> : (
              <ul className="fact-list">
                {overran.slice(0, 4).map((b) => (
                  <li key={b.id}>
                    <span>{b.title}</span>
                    <em className="variance is-over">+{formatDuration(b.varianceMinutes!)}</em>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      {day.isError ? <ErrorNote onRetry={() => day.refetch()}>We could not load this day.</ErrorNote> : <ReviewForm key={date} date={date} review={day.data?.review} />}
    </>
  );
}

function ReviewForm({ date, review }: { date: string; review?: Review }) {
  const toast = useToast();
  const { saveReview } = useDayMutations(date);
  const [form, setForm] = useState<Review | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const value = form ?? review;

  const save = () => {
    if (!form || !review || PROMPTS.every((p) => form[p.key].trim() === review[p.key])) return;
    saveReview.mutate(form, { onSuccess: () => setSavedAt(Date.now()), onError: (err) => toast.error(errorMessage(err)) });
  };

  return (
    <section className="card" aria-labelledby="review">
      <header className="card-head">
        <div>
          <h2 id="review">Three questions</h2>
          <p>Saved as you leave each field.</p>
        </div>
        <AnimatePresence>
          {savedAt > 0 && (
            <motion.span key={savedAt} className="saved" role="status" initial={{ opacity: 0, x: 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
              <CircleCheck size={14} aria-hidden /> Saved
            </motion.span>
          )}
        </AnimatePresence>
      </header>
      <div className="review-grid">
        {PROMPTS.map((p) => (
          <Field key={p.key} label={p.label}>
            {(props) => (
              <Textarea {...props} rows={5} maxLength={1000} placeholder={p.placeholder} disabled={!value} value={value?.[p.key] ?? ""}
                onChange={(e) => value && setForm({ ...value, [p.key]: e.target.value })} onBlur={save} />
            )}
          </Field>
        ))}
      </div>
    </section>
  );
}
