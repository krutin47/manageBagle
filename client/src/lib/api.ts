export type Priority = "High" | "Medium" | "Low";
export type WorkMode = "DeepFocus" | "ShallowWork" | "Meeting" | "Personal";
export type Status = "Planned" | "InProgress" | "Done" | "Skipped";
export type TaskPolicy = "NoTasks" | "AnyTask" | "SelectedAreas";
export type BreakPlacement = "After" | "Before";
export type AreaColor = "teal" | "blue" | "violet" | "rose" | "orange" | "amber" | "green" | "slate";
export type DayName = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

export interface User {
  id: string;
  email: string;
  displayName: string;
  mfaEnabled: boolean;
  hasPassword: boolean;
  /** IANA zone the person plans in; null until first set. */
  timeZone: string | null;
  googleLinked: boolean;
  microsoftLinked: boolean;
  recoveryCodesLeft: number;
}

export interface Area {
  id: string;
  name: string;
  color: AreaColor;
  sortOrder: number;
  /** Recovery break reserved next to each task in this area (P2-C4). */
  breakMinutes: number;
  breakPlacement: BreakPlacement;
}

export interface Block {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  focusAreaId: string | null;
  priority: Priority;
  workMode: WorkMode;
  status: Status;
  actualMinutes: number | null;
  plannedMinutes: number;
  varianceMinutes: number | null;
  notes: string;
  /** Out in the physical world (errands, travel, appointments): may overrun. */
  isOutside: boolean;
  backlogTaskId: string | null;
  /** Zone the block is anchored to. */
  timeZone: string | null;
  /** Changes on every save; sent back so a stale tab cannot overwrite newer work. */
  version: number;
  /** Focus timer (ADR-013): when the current run began, or null; seconds banked by earlier runs. */
  timerStartedAt: string | null;
  trackedSeconds: number;
  /** Extra minutes granted at "time's up"; the plan itself is unchanged. */
  extendedMinutes: number;
  /** Optional note left when the block was put off or dropped. */
  stopNote: string;
  /** Recovery break reserved before / after the block; not planned work. */
  breakBeforeMinutes: number;
  breakAfterMinutes: number;
}

export type StopOutcome = "Finished" | "Later" | "Drop";

export interface TimerSnapshot {
  block: Block;
  /** The server's clock at the moment of the answer: elapsed time is measured against it. */
  serverNow: string;
  pausedBlockId: string | null;
}

export type BlockInput = Omit<Block, "id" | "plannedMinutes" | "varianceMinutes" | "backlogTaskId" | "timeZone" | "version" | "timerStartedAt" | "trackedSeconds" | "extendedMinutes" | "stopNote" | "breakBeforeMinutes" | "breakAfterMinutes"> & { breakBeforeMinutes?: number; breakAfterMinutes?: number };

export interface Task {
  id: string;
  title: string;
  focusAreaId: string | null;
  estimatedMinutes: number | null;
  priority: Priority;
  dueDate: string | null;
  status: Status;
  nextStep: string;
  workMode: WorkMode;
  isOutside: boolean;
  /** How much finishing this moves things forward (priority is urgency). */
  impact: Priority;
  scheduledDate: string | null;
  createdAt: string;
  version: number;
  /** Recovery break for this task; null follows its focus area. */
  breakMinutes: number | null;
}

/** One line of a brain dump. */
export type CaptureItem = Pick<Task, "title" | "estimatedMinutes" | "focusAreaId" | "workMode" | "isOutside" | "priority" | "impact" | "dueDate" | "breakMinutes">;

export type TaskInput = Omit<Task, "id" | "scheduledDate" | "createdAt" | "version" | "breakMinutes"> & { breakMinutes?: number | null };

export interface Outcome {
  rank: number;
  result: string;
  focusAreaId: string | null;
  nextAction: string;
  status: Status;
  minutesNeeded: number | null;
  /** Present when the outcome came from a planned task; ticking either finishes both. */
  backlogTaskId?: string | null;
}

export type ProviderKey = "google" | "microsoft";

export interface PlanItem {
  taskId: string | null;
  title: string;
  estimatedMinutes: number;
  focusAreaId: string | null;
  workMode: WorkMode;
  isOutside: boolean;
  priority: Priority;
  impact: Priority;
  dueDate: string | null;
  topRank: number | null;
  start: string | null;
  end: string | null;
  breakBeforeMinutes: number;
  breakAfterMinutes: number;
  breakMinutes: number | null;
}

export type WeekdayFlag = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

export interface Routine {
  id: string;
  title: string;
  /** Comma-separated weekday flags as the API sends them, e.g. "Monday, Wednesday" or "Workdays". */
  days: string;
  start: string;
  end: string;
  taskPolicy: TaskPolicy;
  areaIds: string[];
  isMeal: boolean;
  /** Colour on the calendar; null is the neutral default. */
  color: AreaColor | null;
}

export type RoutineInput = Omit<Routine, "id">;

/** Time already spoken for on a date: a routine occurrence or a meeting from a connected calendar. `end` may be on the next date. */
export interface Commitment {
  kind: "routine" | "event";
  sourceId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  taskPolicy: TaskPolicy;
  areaIds: string[];
  isMeal: boolean;
  /** The routine's colour; always null for meetings. */
  color: AreaColor | null;
}

export interface CalendarConnection {
  id: string;
  name: string;
  host: string;
  lastFetchedAt: string | null;
  lastError: string;
  eventCount: number;
}

export interface CalendarFeed {
  url: string;
  webcalUrl: string;
}

export interface Preferences {
  dayStart: string;
  dayEnd: string;
  waterReminderMinutes: number | null;
  /** Colour of recovery breaks on the calendar; null is the default green. */
  breakColor: AreaColor | null;
}

export interface Review { biggestWin: string; interruptions: string; changeTomorrow: string }
export interface Day { date: string; outcomes: Outcome[]; review: Review }
export interface Theme { day: DayName; primaryFocus: string; outcome: string; review: string }

export interface DaySummary {
  date: string;
  plannedMinutes: number;
  loggedMinutes: number;
  deepFocusMinutes: number;
  blocks: number;
  blocksDone: number;
  doneRate: number | null;
}

export interface WeekSummary {
  start: string;
  totals: Omit<DaySummary, "date">;
  days: DaySummary[];
  areas: { focusAreaId: string | null; plannedMinutes: number; loggedMinutes: number; shareOfPlan: number }[];
}

/**
 * Every failed call becomes one of these. Components branch on the class (or `code`), never on the
 * wording of a message.
 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Stable machine-readable reason from the server, e.g. "stale_version". */
    public code?: string,
    public fieldErrors: Record<string, string[]> = {},
    /** Matches the server's logs; shown to the user for unexpected failures so support can find it. */
    public traceId?: string,
  ) {
    super(message);
  }

  /** First message for a field, matched case-insensitively (the API reports "Title", forms say "title"). */
  field(name: string): string | undefined {
    const key = Object.keys(this.fieldErrors).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? this.fieldErrors[key]![0] : undefined;
  }
}

/** The request never got an answer: offline, DNS, dropped connection. */
export class NetworkError extends ApiError {}
/** 401: there is no valid session. */
export class UnauthorizedError extends ApiError {}
/** 400: the input was refused; see `fieldErrors`. */
export class ValidationError extends ApiError {}
/** 409: someone else changed this first, or the request collided with another. */
export class ConflictError extends ApiError {}
/** 429: slow down. */
export class RateLimitError extends ApiError {}
/** 5xx or anything unplanned. Carries a trace id. */
export class UnexpectedApiError extends ApiError {}

const FALLBACK: Record<number, string> = {
  401: "Your session has ended. Sign in again.",
  403: "You are not allowed to do that.",
  404: "We could not find that. It may have been deleted.",
  409: "This was changed somewhere else. Reload to see the latest version.",
  429: "Too many attempts. Wait a minute and try again.",
};

interface Problem {
  detail?: string;
  title?: string;
  code?: string;
  traceId?: string;
  errors?: Record<string, string[]>;
}

function toError(status: number, problem: Problem): ApiError {
  const firstFieldError = problem.errors ? Object.values(problem.errors)[0]?.[0] : undefined;
  const message = firstFieldError ?? problem.detail ?? FALLBACK[status] ?? "Something went wrong on our side. Try again.";
  const args = [status, message, problem.code, problem.errors ?? {}, problem.traceId] as const;
  if (status === 401) return new UnauthorizedError(...args);
  if (status === 400 || status === 422) return new ValidationError(...args);
  if (status === 409) return new ConflictError(...args);
  if (status === 429) return new RateLimitError(...args);
  if (status >= 500) return new UnexpectedApiError(...args);
  return new ApiError(...args);
}

// ---- Antiforgery token ---------------------------------------------------------------------------
// The server issues a token bound to this browser and the signed-in account. It lives in memory only,
// is sent with every state-changing request, and is fetched again whenever the account changes.

let csrf: Promise<string> | null = null;

export function resetCsrfToken() {
  csrf = null;
}

function csrfToken(): Promise<string> {
  csrf ??= fetch("/api/auth/csrf", { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then((r) => {
      if (!r.ok) throw new Error("token");
      return r.json() as Promise<{ token: string }>;
    })
    .then((body) => body.token)
    .catch((e) => {
      csrf = null;
      throw e;
    });
  return csrf;
}

interface Options {
  method?: string;
  body?: unknown;
  /** From TanStack Query: cancels the request when its result is no longer wanted (e.g. the day changed). */
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

async function send(path: string, init: Options): Promise<Response> {
  const method = init.method ?? "GET";
  const unsafe = method !== "GET" && method !== "HEAD";
  return fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    signal: init.signal,
    headers: {
      Accept: "application/json",
      "X-MB-Client": "web",
      ...(unsafe ? { "X-CSRF-TOKEN": await csrfToken() } : {}),
      ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}

async function readProblem(response: Response): Promise<Problem> {
  try {
    return (await response.json()) as Problem;
  } catch {
    return {}; // not JSON (a proxy's error page, say)
  }
}

export async function api<T = void>(path: string, init: Options = {}): Promise<T> {
  let response: Response;
  let problem: Problem = {};
  try {
    response = await send(path, init);
    if (response.status === 400) {
      problem = await readProblem(response);
      if (problem.code === "csrf_invalid") {
        // The account changed under us (signed in or out in another tab). One fresh token, one retry.
        resetCsrfToken();
        response = await send(path, init);
        problem = response.ok ? {} : await readProblem(response);
      }
    } else if (!response.ok) {
      problem = await readProblem(response);
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") throw e; // cancelled on purpose: not an error to show
    throw new NetworkError(0, "You appear to be offline. Check your connection and try again.");
  }

  if (response.ok) {
    // Signing in, out, or confirming an email changes who the token belongs to.
    if (path.startsWith("/auth/") && (init.method ?? "GET") !== "GET") resetCsrfToken();
    if (response.status === 204 || response.status === 202 && response.headers.get("Content-Length") === "0") return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  problem.traceId ??= response.headers.get("X-Trace-Id") ?? undefined;
  const error = toError(response.status, problem);
  if (error instanceof UnauthorizedError && !path.startsWith("/auth/")) {
    window.dispatchEvent(new CustomEvent("mb:signed-out"));
  }
  throw error;
}

/** Text safe to show a person. Unexpected failures include a short reference that matches the server logs. */
export function errorMessage(e: unknown): string {
  if (e instanceof UnexpectedApiError && e.traceId) return `${e.message} Reference: ${e.traceId.slice(0, 8)}.`;
  return e instanceof Error ? e.message : "Something went wrong. Try again.";
}
