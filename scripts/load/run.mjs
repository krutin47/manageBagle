// Workload simulation (handbook Phase 3). No dependencies: Node 22's fetch.
//
// Signs up USERS real accounts (email confirmation read from the SMTP pickup directory), gives each a
// planned day, then has them all use the app at once for DURATION seconds with a realistic mix of
// journeys. Prints per-journey and per-route p50 / p95 / p99 latency, throughput and errors as JSON.
//
//   BASE=http://localhost:5242 MAIL_DIR=/path/to/.mail USERS=50 DURATION=60 node scripts/load/run.mjs
//
// The server must allow the sign-ups: RateLimits__AuthPerMinute high enough for USERS.
import { env } from "node:process";
import { Session, signUp as createAccount } from "./session.mjs";

const BASE = env.BASE ?? "http://localhost:5242";
const MAIL_DIR = env.MAIL_DIR ?? "";
const USERS = Number(env.USERS ?? 20);
const DURATION = Number(env.DURATION ?? 30) * 1000;
const THINK_MS = Number(env.THINK_MS ?? 250); // pause between journeys per user

const samples = new Map(); // name -> number[]
let errors = 0;
const errorKinds = new Map();
const record = (name, ms) => (samples.get(name) ?? samples.set(name, []).get(name)).push(ms);

const today = new Date().toISOString().slice(0, 10);
const weekFrom = today, weekTo = new Date(Date.now() + 6 * 864e5).toISOString().slice(0, 10);

const onError = (key) => { errors++; errorKinds.set(key, (errorKinds.get(key) ?? 0) + 1); };

async function signUp(i) {
  const s = new Session(BASE, record, onError);
  await createAccount(s, MAIL_DIR, `load${i}`);
  const items = Array.from({ length: 6 }, (_, n) => ({
    taskId: null, title: `Task ${n}`, estimatedMinutes: 30, focusAreaId: null, workMode: "ShallowWork", isOutside: false, priority: "Medium",
    topRank: n < 3 ? n + 1 : null, start: `${String(9 + n).padStart(2, "0")}:00:00`, end: `${String(9 + n).padStart(2, "0")}:30:00`,
  }));
  await s.call("POST", `/api/days/${today}/plan`, { items }, { "Idempotency-Key": crypto.randomUUID() });
  await s.call("POST", "/api/backlog/capture", { items: Array.from({ length: 20 }, (_, n) => ({ title: `Backlog ${n}`, estimatedMinutes: 30, focusAreaId: null, workMode: "ShallowWork", isOutside: false, priority: "Low", impact: "Medium", dueDate: null, breakMinutes: null })) });
  return s;
}

// The journeys people actually make, weighted by how often.
const JOURNEYS = [
  { name: "open Today", weight: 5, run: async (s) => {
    await Promise.all([s.call("GET", "/api/auth/me"), s.call("GET", `/api/days/${today}`), s.call("GET", `/api/blocks?from=${weekFrom}&to=${weekTo}`),
      s.call("GET", "/api/backlog"), s.call("GET", `/api/commitments?from=${weekFrom}&to=${weekTo}`), s.call("GET", "/api/timer"), s.call("GET", "/api/preferences")]);
  } },
  { name: "open Planner", weight: 2, run: async (s) => {
    await Promise.all([s.call("GET", `/api/blocks?from=${weekFrom}&to=${weekTo}`), s.call("GET", `/api/commitments?from=${weekFrom}&to=${weekTo}`), s.call("GET", "/api/areas")]);
  } },
  { name: "open Week", weight: 1, run: async (s) => { await s.call("GET", `/api/summary/week?start=${weekFrom}`); } },
  { name: "tick a block", weight: 2, run: async (s) => {
    const blocks = await s.call("GET", `/api/blocks?from=${today}&to=${today}`);
    const b = blocks?.[Math.floor(Math.random() * blocks.length)];
    if (b) await s.call("PATCH", `/api/blocks/${b.id}/progress`, { status: b.status === "Done" ? "Planned" : "Done", version: b.version });
  } },
  { name: "brain dump", weight: 1, run: async (s) => {
    await s.call("POST", "/api/backlog/capture", { items: [1, 2, 3].map((n) => ({ title: `Thought ${n}`, estimatedMinutes: 15, focusAreaId: null, workMode: "ShallowWork", isOutside: false, priority: "Low", impact: "Low", dueDate: null, breakMinutes: null })) });
  } },
];
const totalWeight = JOURNEYS.reduce((t, j) => t + j.weight, 0);
const pick = () => { let r = Math.random() * totalWeight; return JOURNEYS.find((j) => (r -= j.weight) < 0); };

const pct = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s.length ? +s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))].toFixed(1) : null; };
const summary = (xs) => ({ count: xs.length, p50: pct(xs, 50), p95: pct(xs, 95), p99: pct(xs, 99), max: xs.length ? +Math.max(...xs).toFixed(1) : null });

const setupStart = performance.now();
const sessions = [];
for (let i = 0; i < USERS; i += 10) sessions.push(...(await Promise.all(Array.from({ length: Math.min(10, USERS - i) }, (_, k) => signUp(i + k)))));
const setupSeconds = (performance.now() - setupStart) / 1000;
samples.clear(); errors = 0; errorKinds.clear(); // measure the workload only

const journeyTimes = new Map();
const stopAt = Date.now() + DURATION;
const started = performance.now();
await Promise.all(sessions.map(async (s) => {
  while (Date.now() < stopAt) {
    const j = pick();
    const t0 = performance.now();
    try { await j.run(s); } catch { errors++; }
    (journeyTimes.get(j.name) ?? journeyTimes.set(j.name, []).get(j.name)).push(performance.now() - t0);
    await new Promise((r) => setTimeout(r, THINK_MS * (0.5 + Math.random())));
  }
}));
const seconds = (performance.now() - started) / 1000;
const requests = [...samples.values()].reduce((t, xs) => t + xs.length, 0);
console.log(JSON.stringify({
  users: USERS, durationSeconds: +seconds.toFixed(1), setupSeconds: +setupSeconds.toFixed(1), requests, requestsPerSecond: +(requests / seconds).toFixed(1),
  errors, errorKinds: Object.fromEntries(errorKinds),
  journeysMs: Object.fromEntries([...journeyTimes].map(([k, xs]) => [k, summary(xs)])),
  routesMs: Object.fromEntries([...samples].sort().map(([k, xs]) => [k, summary(xs)])),
}, null, 2));
