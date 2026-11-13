import { ArrowRight, X } from "lucide-react";
import { motion } from "motion/react";
import { Link, useSearchParams } from "react-router";
import { IconButton, PageHeader } from "../../components/ui";
import { useDocumentTitle } from "../../lib/hooks";
import { useUser } from "../../lib/queries";

const LOOP = [
  { title: "Choose outcomes", body: "Pick your three outcomes for the day — not fifteen unrelated tasks.", to: "/", cta: "Open Today" },
  { title: "Make appointments", body: "Give each outcome a date, a start and an end. Use 5, 15, 30 or 60+ minute slots.", to: "/planner", cta: "Open Planner" },
  { title: "Batch similar work", body: "Protect one or two deep-focus blocks. Cluster email, errands and admin together.", to: "/planner", cta: "Open Planner" },
  { title: "Track reality", body: "Log the actual minutes and mark blocks done or skipped. The variance works itself out.", to: "/", cta: "Open Today" },
  { title: "Review and adjust", body: "Check the week. Keep what works and change what keeps running over.", to: "/week", cta: "Open Week" },
];

const SIZES = [
  { size: "5–15 min", use: "Batching tiny tasks", example: "Inbox, replies", rule: "Avoid constant switching" },
  { size: "25–45 min", use: "Medium tasks", example: "Planning, calls", rule: "One clear outcome" },
  { size: "60–120 min", use: "Focus and building", example: "Coding, portfolio", rule: "Notifications off" },
  { size: "30–60 min", use: "Personal recovery", example: "Walk, meals, breaks", rule: "Protect this too" },
];

export function GuidePage() {
  useDocumentTitle("Guide");
  const user = useUser();
  const [params, setParams] = useSearchParams();
  const welcome = params.get("welcome") === "1";

  return (
    <>
      {welcome && (
        <motion.div className="welcome" initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} role="status">
          <div>
            <strong>Welcome, {user.displayName.split(" ")[0]}.</strong> Your focus areas and day themes are set up with sensible defaults — change them any time in <Link to="/settings">Settings</Link>. Turning on two-step verification there takes a minute.
          </div>
          <IconButton size="sm" label="Dismiss" onClick={() => setParams({}, { replace: true })}><X size={16} /></IconButton>
        </motion.div>
      )}

      <PageHeader eyebrow="How this works" title="Own your time" sub="Ten minutes to plan, five minutes to review. That is the whole system." />

      <section className="card" aria-labelledby="loop">
        <header className="card-head"><div><h2 id="loop">Your daily loop</h2></div></header>
        <ol className="loop">
          {LOOP.map((step, i) => (
            <motion.li key={step.title} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.05 * i, duration: 0.3 }}>
              <span className="loop-num">{String(i + 1).padStart(2, "0")}</span>
              <div>
                <h3>{step.title}</h3>
                <p>{step.body}</p>
              </div>
              <Link to={step.to} className="loop-link">{step.cta} <ArrowRight size={14} aria-hidden /></Link>
            </motion.li>
          ))}
        </ol>
      </section>

      <section className="card" aria-labelledby="sizes">
        <header className="card-head"><div><h2 id="sizes">Recommended block sizes</h2></div></header>
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Block</th><th>Use it for</th><th>Example</th><th>Rule</th></tr></thead>
            <tbody>
              {SIZES.map((s) => (
                <tr key={s.size}><th scope="row" className="mono nowrap">{s.size}</th><td>{s.use}</td><td>{s.example}</td><td>{s.rule}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="rule-card">
        <h2>A small rule that makes this work</h2>
        <p>Schedule the result, not just the topic. “Draft 400 words” is a better block than “work on content”. Leave buffers for delays, and move unfinished work deliberately instead of letting it drift.</p>
        <p className="rule-foot">An empty “actual minutes” means <em>not recorded yet</em>, never zero. Your totals only count what you log.</p>
      </section>
    </>
  );
}
