// Shared by the load test and the two-instance check: a signed-in API client with its own cookies
// and antiforgery token, and a sign-up that reads the confirmation email from the pickup directory.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const PASSWORD = "Correct-horse-battery-9";

export class Session {
  cookies = new Map();
  csrf = "";
  constructor(base, onSample = () => {}, onError = () => {}) { this.base = base; this.onSample = onSample; this.onError = onError; }
  label(method, path) { return `${method} ${path.replace(/[0-9a-f-]{36}/g, "{id}").replace(/\d{4}-\d{2}-\d{2}/g, "{date}").replace(/\?.*$/, "")}`; }
  async request(method, path, body, extra = {}) {
    const headers = { "X-MB-Client": "script", Origin: this.base, Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; "), ...extra };
    if (method !== "GET") headers["X-CSRF-TOKEN"] = this.csrf;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const started = performance.now();
    const res = await fetch(this.base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual" });
    const text = await res.text();
    this.onSample(this.label(method, path), performance.now() - started);
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      this.cookies.set(pair.slice(0, i), pair.slice(i + 1));
    }
    if (res.status >= 400) this.onError(`${res.status} ${this.label(method, path)}`);
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }
  async call(method, path, body, extra) { return (await this.request(method, path, body, extra)).body; }
  async refreshCsrf() { this.csrf = (await this.call("GET", "/api/auth/csrf")).token; }
  /** Another client (e.g. on another instance) carrying this one's cookies. */
  cloneTo(base) { const s = new Session(base, this.onSample, this.onError); s.cookies = new Map(this.cookies); s.csrf = this.csrf; return s; }
}

export async function signUp(session, mailDir, name) {
  await session.refreshCsrf();
  const email = `${name}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  await session.call("POST", "/api/auth/register", { email, password: PASSWORD, displayName: name });
  let link;
  for (let tries = 0; tries < 50 && !link; tries++) {
    const mail = readdirSync(mailDir).map((f) => readFileSync(join(mailDir, f), "utf8")).find((t) => t.startsWith(`To: ${email}\n`));
    link = mail?.match(/https?:\/\/\S+/)?.[0];
    if (!link) await new Promise((r) => setTimeout(r, 100));
  }
  if (!link) throw new Error(`no confirmation email for ${email}`);
  const url = new URL(link);
  await session.call("POST", "/api/auth/email/confirm", { userId: url.searchParams.get("userId"), token: url.searchParams.get("token") });
  await session.refreshCsrf(); // the antiforgery token is bound to the signed-in user
  return email;
}
