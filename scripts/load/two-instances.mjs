// Two app instances behind one database (handbook Phase 3: "validate a two-replica environment").
//
//   A=http://localhost:5300 B=http://localhost:5301 MAIL_DIR=… node scripts/load/two-instances.mjs check  SESSION_FILE=…
//   (restart instance A)
//   A=http://localhost:5300 SESSION_FILE=… node scripts/load/two-instances.mjs resume
//
// "check" proves sessions, antiforgery tokens, optimistic concurrency, the one-running-timer rule and
// session revocation work across instances; it saves one signed-in session to SESSION_FILE.
// "resume" proves that session still works after instance A restarts (key ring in the database).
// Both instances need Auth__SessionRevalidateSeconds=0 for the revocation step.
import { readFileSync, writeFileSync } from "node:fs";
import { argv, env, exit } from "node:process";
import { PASSWORD, Session, signUp } from "./session.mjs";

const results = [];
const check = (name, ok, detail = "") => { results.push({ name, ok }); console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`); };
const today = new Date().toISOString().slice(0, 10);

if (argv[2] === "resume") {
  const saved = JSON.parse(readFileSync(env.SESSION_FILE, "utf8"));
  const s = new Session(env.A);
  s.cookies = new Map(saved.cookies);
  const me = await s.request("GET", "/api/auth/me");
  check("a session survives restarting the instance", me.status === 200 && me.body.email === saved.email, `status ${me.status}`);
} else {
  const a = new Session(env.A);
  const email = await signUp(a, env.MAIL_DIR, "replica");
  const b = a.cloneTo(env.B);

  const me = await b.request("GET", "/api/auth/me");
  check("a cookie issued by A is accepted by B", me.status === 200 && me.body.email === email, `status ${me.status}`);

  const item = (title) => ({ title, estimatedMinutes: 30, focusAreaId: null, workMode: "ShallowWork", isOutside: false, priority: "Low", impact: "Low", dueDate: null, breakMinutes: null });
  const writeOnB = await b.request("POST", "/api/backlog/capture", { items: [item("Written on B with A's token")] });
  check("an antiforgery token from A is accepted by B", writeOnB.status === 200, `status ${writeOnB.status}`);
  await b.refreshCsrf();
  a.csrf = b.csrf;
  const writeOnA = await a.request("POST", "/api/backlog/capture", { items: [item("Written on A with B's token")] });
  check("an antiforgery token from B is accepted by A", writeOnA.status === 200, `status ${writeOnA.status}`);

  const [task] = writeOnA.body;
  const body = { title: task.title, estimatedMinutes: 30, priority: "Low", status: "Planned", workMode: "ShallowWork", version: task.version };
  const [r1, r2] = await Promise.all([a.request("PUT", `/api/backlog/${task.id}`, { ...body, title: "Edit via A" }), b.request("PUT", `/api/backlog/${task.id}`, { ...body, title: "Edit via B" })]);
  check("simultaneous edits on two instances: exactly one wins, the other is told", [r1.status, r2.status].sort().join() === "200,409", `${r1.status} and ${r2.status}`);

  const items = [0, 1].map((n) => ({ taskId: null, title: `Block ${n}`, estimatedMinutes: 30, focusAreaId: null, workMode: "ShallowWork", isOutside: false, priority: "Low", topRank: null, start: `1${n}:00:00`, end: `1${n}:30:00` }));
  await a.call("POST", `/api/days/${today}/plan`, { items }, { "Idempotency-Key": crypto.randomUUID() });
  const blocks = await a.call("GET", `/api/blocks?from=${today}&to=${today}`);
  const [t1, t2] = await Promise.all([a.request("POST", `/api/blocks/${blocks[0].id}/timer/start`, { pauseRunning: false }), b.request("POST", `/api/blocks/${blocks[1].id}/timer/start`, { pauseRunning: false })]);
  const running = await a.call("GET", "/api/timer");
  check("two instances starting different timers at once still leave one running", [t1.status, t2.status].filter((s) => s === 200).length === 1 && !!running, `${t1.status} and ${t2.status}`);

  // A second account whose session is saved for the restart check.
  const keeper = new Session(env.A);
  const keeperEmail = await signUp(keeper, env.MAIL_DIR, "keeper");
  writeFileSync(env.SESSION_FILE, JSON.stringify({ email: keeperEmail, cookies: [...keeper.cookies] }));

  // Changing the password on A ends the old session on B too (security stamp in the database).
  const stale = b.cloneTo(env.B);
  const changed = await a.request("POST", "/api/auth/password", { currentPassword: PASSWORD, newPassword: `${PASSWORD}-new` });
  const after = await stale.request("GET", "/api/auth/me");
  check("a password change on A signs the old session out on B", changed.status === 204 && after.status === 401, `change ${changed.status}, then ${after.status}`);
}
exit(results.every((r) => r.ok) ? 0 : 1);
