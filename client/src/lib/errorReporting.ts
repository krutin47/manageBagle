import { api } from "./api";

/**
 * Sends browser errors to the server log, where they sit next to server errors with the same kind of
 * reference. Only the error's name and message and the path are sent — no query strings, no form
 * contents. At most five reports per page load, and a failure to report is silently dropped
 * (reporting must never cause a second error).
 */
const MAX_REPORTS = 5;
let sent = 0;
const seen = new Set<string>();

export const newReference = () => Math.random().toString(36).slice(2, 10);

export function reportClientError(
  kind: "render" | "script" | "promise",
  error: unknown,
  reference = newReference(),
): string {
  const message = (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 300);
  if (sent >= MAX_REPORTS || seen.has(message)) return reference;
  seen.add(message);
  sent++;
  void api("/client-errors", {
    method: "POST",
    body: { kind, message, route: window.location.pathname.slice(0, 200), reference, release: import.meta.env.MODE },
  }).catch(() => undefined);
  return reference;
}

export function installGlobalErrorReporting() {
  window.addEventListener("error", (e) => reportClientError("script", e.error ?? e.message));
  window.addEventListener("unhandledrejection", (e) => {
    // A cancelled request is not a failure.
    if (e.reason instanceof DOMException && e.reason.name === "AbortError") return;
    reportClientError("promise", e.reason);
  });
}
