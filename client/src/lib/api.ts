export type Priority = "High" | "Medium" | "Low";
export type WorkMode = "DeepFocus" | "ShallowWork" | "Meeting" | "Personal";
export type Status = "Planned" | "InProgress" | "Done" | "Skipped";
export type AreaColor = "teal" | "blue" | "violet" | "rose" | "orange" | "amber" | "green" | "slate";
export type DayName = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday" | "Sunday";

export interface User {
  id: string;
  email: string;
  displayName: string;
  mfaEnabled: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  microsoftLinked: boolean;
  recoveryCodesLeft: number;
}

export interface Area { id: string; name: string; color: AreaColor; sortOrder: number }

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
}

export type BlockInput = Omit<Block, "id" | "plannedMinutes" | "varianceMinutes" | "backlogTaskId">;

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
}

export type TaskInput = Omit<Task, "id" | "scheduledDate" | "createdAt">;

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

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
    public fieldErrors: Record<string, string[]> = {},
  ) {
    super(message);
  }

  /** First message for a field, matched case-insensitively (the API reports "Title", forms say "title"). */
  field(name: string): string | undefined {
    const key = Object.keys(this.fieldErrors).find((k) => k.toLowerCase() === name.toLowerCase());
    return key ? this.fieldErrors[key][0] : undefined;
  }
}

const FALLBACK: Record<number, string> = {
  401: "Your session has ended. Sign in again.",
  403: "You are not allowed to do that.",
  404: "We could not find that. It may have been deleted.",
  429: "Too many attempts. Wait a minute and try again.",
};

export async function api<T = void>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api${path}`, {
      method: init.method ?? "GET",
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        "X-MB-Client": "web",
        ...(init.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch {
    throw new ApiError(0, "You appear to be offline. Check your connection and try again.");
  }

  if (response.ok) {
    if (response.status === 204 || response.status === 202) return undefined as T;
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  let problem: { detail?: string; title?: string; code?: string; errors?: Record<string, string[]> } = {};
  try {
    problem = await response.json();
  } catch {
    /* not JSON */
  }
  const firstFieldError = problem.errors ? Object.values(problem.errors)[0]?.[0] : undefined;
  const message = problem.detail ?? firstFieldError ?? FALLBACK[response.status] ?? "Something went wrong on our side. Try again.";
  const error = new ApiError(response.status, message, problem.code, problem.errors ?? {});
  if (response.status === 401 && !path.startsWith("/auth/")) {
    window.dispatchEvent(new CustomEvent("mb:signed-out"));
  }
  throw error;
}

export const errorMessage = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");
