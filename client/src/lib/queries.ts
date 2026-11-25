import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import {
  api, UnauthorizedError, type CaptureItem,
  type Area, type AreaColor, type Block, type CalendarConnection, type CalendarFeed, type Commitment, type Preferences, type Routine, type RoutineInput, type BlockInput, type Day, type DayName, type Outcome, type PlanItem, type ProviderKey,
  type Review, type Status, type StopOutcome, type Task, type TaskInput, type Theme, type TimerSnapshot, type User, type WeekSummary, type WorkMode,
} from "./api";
import { syncServerClock } from "./timerClock";
import { addDays, fromMinutes, toMinutes, weekStart } from "./time";

/**
 * Server data has exactly one owner: the TanStack Query cache. These are its keys, in one place, so
 * invalidation is always targeted and never a guess at a string.
 */
export const keys = {
  me: ["me"] as const,
  providers: ["providers"] as const,
  areas: ["areas"] as const,
  blocks: {
    all: ["blocks"] as const,
    week: (monday: string) => ["blocks", monday] as const,
  },
  weekSummary: {
    all: ["week"] as const,
    of: (monday: string) => ["week", monday] as const,
  },
  days: {
    all: ["day"] as const,
    of: (date: string) => ["day", date] as const,
  },
  themes: ["themes"] as const,
  backlog: ["backlog"] as const,
  timer: ["timer"] as const,
  routines: ["routines"] as const,
  commitments: {
    all: ["commitments"] as const,
    week: (monday: string) => ["commitments", monday] as const,
  },
  preferences: ["preferences"] as const,
  calendarFeed: ["calendar-feed"] as const,
  calendarConnections: ["calendar-connections"] as const,
};

/** How long each kind of data may be shown before it is quietly refreshed. Mutations invalidate sooner. */
const STALE = {
  planning: 30_000, // blocks, backlog, the day: change often
  reference: 10 * 60_000, // focus areas, themes: change rarely
  account: 5 * 60_000,
};

const withSeconds = (t: string) => (t.length === 5 ? `${t}:00` : t);

// ---- Session ---------------------------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: keys.me,
    queryFn: async ({ signal }) => {
      try {
        return await api<User>("/auth/me", { signal });
      } catch (e) {
        if (e instanceof UnauthorizedError) return null;
        throw e;
      }
    },
    staleTime: STALE.account,
    retry: false,
  });
}

/** The signed-in user. Only call beneath the authenticated shell. */
export function useUser(): User {
  const { data } = useMe();
  if (!data) throw new Error("useUser called while signed out");
  return data;
}

export function useProviders() {
  return useQuery({ queryKey: keys.providers, queryFn: ({ signal }) => api<Record<ProviderKey, boolean>>("/auth/providers", { signal }), staleTime: Infinity });
}

// ---- Focus areas -----------------------------------------------------------------------------

export function useAreas() {
  return useQuery({ queryKey: keys.areas, queryFn: ({ signal }) => api<Area[]>("/areas", { signal }), staleTime: STALE.reference });
}

export function useAreaMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: keys.areas });
    qc.invalidateQueries({ queryKey: keys.weekSummary.all });
  };
  return {
    create: useMutation({ mutationFn: (body: { name: string; color: AreaColor }) => api<Area>("/areas", { method: "POST", body }), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name: string; color: AreaColor; breakMinutes: number; breakPlacement: Area["breakPlacement"] }) => api<Area>(`/areas/${id}`, { method: "PUT", body }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/areas/${id}`, { method: "DELETE" }),
      onSuccess: () => {
        done();
        invalidatePlanning(qc);
        qc.invalidateQueries({ queryKey: keys.backlog });
        qc.invalidateQueries({ queryKey: keys.days.all });
      },
    }),
  };
}

// ---- Time blocks -----------------------------------------------------------------------------

/** Blocks are always fetched a whole week (Mon–Sun) at a time so Today, Planner and Week share one cache. */
export function useWeekBlocks(anyDateInWeek: string) {
  const start = weekStart(anyDateInWeek);
  return useQuery({
    queryKey: keys.blocks.week(start),
    queryFn: ({ signal }) => api<Block[]>(`/blocks?from=${start}&to=${addDays(start, 6)}`, { signal }),
    staleTime: STALE.planning,
  });
}

function invalidatePlanning(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: keys.blocks.all });
  qc.invalidateQueries({ queryKey: keys.weekSummary.all });
}

/**
 * The newest copy of a block the cache holds. Its version is read at the moment a save is sent, not
 * when the action was queued, so a quick second edit builds on the first instead of colliding with it.
 */
function cachedBlock(qc: QueryClient, id: string): Block | undefined {
  for (const [, list] of qc.getQueriesData<Block[]>({ queryKey: keys.blocks.all })) {
    const found = list?.find((b) => b.id === id);
    if (found) return found;
  }
  return undefined;
}

/** Puts the server's answer (with its new version) into the cache straight away. */
function storeBlock(qc: QueryClient, saved: Block) {
  qc.setQueriesData<Block[]>({ queryKey: keys.blocks.all }, (list) => list?.map((b) => (b.id === saved.id ? saved : b)));
}

const blockBody = (b: BlockInput) => ({ ...b, start: withSeconds(b.start), end: withSeconds(b.end) });

/** Writes to blocks run one after another, so each sees the version the previous one produced. */
const BLOCK_WRITES = { id: "block-writes" };
const TASK_WRITES = { id: "task-writes" };

export function useBlockMutations() {
  const qc = useQueryClient();
  const settle = () => {
    invalidatePlanning(qc);
    qc.invalidateQueries({ queryKey: keys.backlog });
  };
  return {
    create: useMutation({ mutationFn: (b: BlockInput) => api<Block>("/blocks", { method: "POST", body: blockBody(b) }), onSuccess: settle }),
    update: useMutation({
      scope: BLOCK_WRITES,
      mutationFn: ({ id, ...b }: BlockInput & { id: string }) =>
        api<Block>(`/blocks/${id}`, { method: "PUT", body: { ...blockBody(b), version: cachedBlock(qc, id)?.version } }),
      onSuccess: (saved) => storeBlock(qc, saved),
      onSettled: () => {
        settle();
        qc.invalidateQueries({ queryKey: keys.days.all });
      },
    }),
    /** Optimistic: dragging a block to another day or time should land where it was dropped. */
    move: useMutation({
      scope: BLOCK_WRITES,
      mutationFn: ({ block, date, start }: { block: Block; date: string; start: string }) => {
        const { title, focusAreaId, priority, workMode, status, actualMinutes, notes, isOutside } = block;
        const end = fromMinutes(toMinutes(start) + block.plannedMinutes);
        const body = { ...blockBody({ date, start, end, title, focusAreaId, priority, workMode, status, actualMinutes, notes, isOutside }), version: cachedBlock(qc, block.id)?.version };
        return api<Block>(`/blocks/${block.id}`, { method: "PUT", body });
      },
      onMutate: async ({ block, date, start }) => {
        const key = keys.blocks.week(weekStart(block.date));
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<Block[]>(key);
        const end = fromMinutes(toMinutes(start) + block.plannedMinutes);
        qc.setQueryData<Block[]>(key, (list) =>
          list?.map((b) => (b.id === block.id ? { ...b, date, start, end } : b)).sort((a, b) => a.date.localeCompare(b.date) || a.start.localeCompare(b.start)),
        );
        return { key, previous };
      },
      onSuccess: (saved) => storeBlock(qc, saved),
      onError: (_e, _v, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
      onSettled: settle,
    }),
    /** Optimistic: ticking a block off should feel instant. */
    progress: useMutation({
      scope: BLOCK_WRITES,
      mutationFn: ({ block, ...body }: { block: Block; status?: Status; actualMinutes?: number; clearActual?: boolean }) =>
        api<Block>(`/blocks/${block.id}/progress`, { method: "PATCH", body: { ...body, version: cachedBlock(qc, block.id)?.version } }),
      onMutate: async ({ block, status, actualMinutes, clearActual }) => {
        const key = keys.blocks.week(weekStart(block.date));
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<Block[]>(key);
        qc.setQueryData<Block[]>(key, (list) =>
          list?.map((b) => {
            if (b.id !== block.id) return b;
            const actual = clearActual ? null : (actualMinutes ?? b.actualMinutes);
            return { ...b, status: status ?? b.status, actualMinutes: actual, varianceMinutes: actual === null ? null : actual - b.plannedMinutes };
          }),
        );
        return { key, previous };
      },
      onSuccess: (saved) => storeBlock(qc, saved),
      onError: (_e, _v, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
      onSettled: () => {
        settle();
        qc.invalidateQueries({ queryKey: keys.days.all }); // a finished block may tick a top-three outcome
      },
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/blocks/${id}`, { method: "DELETE" }), onSuccess: settle }),
  };
}

export function useWeekSummary(start: string) {
  return useQuery({
    queryKey: keys.weekSummary.of(start),
    queryFn: ({ signal }) => api<WeekSummary>(`/summary/week?start=${start}`, { signal }),
    staleTime: STALE.planning,
    placeholderData: (previous) => previous,
  });
}

// ---- Daily focus -----------------------------------------------------------------------------

export function useDay(date: string) {
  return useQuery({ queryKey: keys.days.of(date), queryFn: ({ signal }) => api<Day>(`/days/${date}`, { signal }), staleTime: STALE.planning });
}

export function useDayMutations(date: string) {
  const qc = useQueryClient();
  const key = keys.days.of(date);
  const done = () => qc.invalidateQueries({ queryKey: key });
  return {
    saveOutcome: useMutation({
      mutationFn: ({ rank, ...body }: Outcome) => api<Outcome>(`/days/${date}/outcomes/${rank}`, { method: "PUT", body }),
      onMutate: async (next) => {
        await qc.cancelQueries({ queryKey: key });
        const previous = qc.getQueryData<Day>(key);
        qc.setQueryData<Day>(key, (d) => d && { ...d, outcomes: [...d.outcomes.filter((o) => o.rank !== next.rank), next].sort((a, b) => a.rank - b.rank) });
        return { previous };
      },
      onError: (_e, _v, ctx) => qc.setQueryData(key, ctx?.previous),
      onSettled: () => {
        done();
        invalidatePlanning(qc); // a ticked outcome may finish its block and task
        qc.invalidateQueries({ queryKey: keys.backlog });
      },
    }),
    removeOutcome: useMutation({ mutationFn: (rank: number) => api(`/days/${date}/outcomes/${rank}`, { method: "DELETE" }), onSuccess: done }),
    saveReview: useMutation({
      mutationFn: (body: Review) => api<Review>(`/days/${date}/review`, { method: "PUT", body }),
      onSuccess: (review) => qc.setQueryData<Day>(key, (d) => d && { ...d, review }),
    }),
  };
}

/**
 * Saves a whole day plan (new tasks, booked blocks, top three) in one request. The idempotency key
 * makes a double click or a retry after a dropped connection save it once.
 */
export function usePlanDay(date: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ items, idempotencyKey }: { items: PlanItem[]; idempotencyKey: string }) =>
      api<{ tasksCreated: number; blocksBooked: number; leftInBacklog: number }>(`/days/${date}/plan`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey },
        body: { items: items.map((i) => ({ ...i, start: i.start && withSeconds(i.start), end: i.end && withSeconds(i.end) })) },
      }),
    onSuccess: () => {
      invalidatePlanning(qc);
      qc.invalidateQueries({ queryKey: keys.days.of(date) });
      qc.invalidateQueries({ queryKey: keys.backlog });
    },
  });
}

export function useThemes() {
  return useQuery({ queryKey: keys.themes, queryFn: ({ signal }) => api<Theme[]>("/themes", { signal }), staleTime: STALE.reference });
}

export function useSaveTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ day, ...body }: Theme) => api<Theme>(`/themes/${day satisfies DayName}`, { method: "PUT", body }),
    onSuccess: (saved) => qc.setQueryData<Theme[]>(keys.themes, (list) => list?.map((t) => (t.day === saved.day ? saved : t))),
  });
}

// ---- Backlog ---------------------------------------------------------------------------------

export function useBacklog() {
  return useQuery({ queryKey: keys.backlog, queryFn: ({ signal }) => api<Task[]>("/backlog", { signal }), staleTime: STALE.planning });
}

/** The brain dump (P2-E1): many tasks into the backlog in one all-or-nothing save; nothing is booked. */
export function useCaptureTasks() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (items: CaptureItem[]) => api<Task[]>("/backlog/capture", { method: "POST", body: { items } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.backlog }),
  });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: keys.backlog });
  return {
    create: useMutation({ mutationFn: (body: TaskInput) => api<Task>("/backlog", { method: "POST", body }), onSuccess: done }),
    update: useMutation({
      scope: TASK_WRITES,
      mutationFn: ({ id, ...body }: TaskInput & { id: string }) =>
        api<Task>(`/backlog/${id}`, { method: "PUT", body: { ...body, version: qc.getQueryData<Task[]>(keys.backlog)?.find((t) => t.id === id)?.version } }),
      onMutate: async (next) => {
        await qc.cancelQueries({ queryKey: keys.backlog });
        const previous = qc.getQueryData<Task[]>(keys.backlog);
        qc.setQueryData<Task[]>(keys.backlog, (list) => list?.map((t) => (t.id === next.id ? { ...t, ...next } : t)));
        return { previous };
      },
      onSuccess: (saved) => qc.setQueryData<Task[]>(keys.backlog, (list) => list?.map((t) => (t.id === saved.id ? saved : t))),
      onError: (_e, _v, ctx) => qc.setQueryData(keys.backlog, ctx?.previous),
      onSettled: done,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/backlog/${id}`, { method: "DELETE" }), onSuccess: done }),
    schedule: useMutation({
      mutationFn: ({ id, start, end, ...rest }: { id: string; date: string; start: string; end: string; workMode: WorkMode }) =>
        api<{ task: Task; block: Block }>(`/backlog/${id}/schedule`, { method: "POST", body: { ...rest, start: withSeconds(start), end: withSeconds(end) } }),
      onSuccess: () => {
        done();
        invalidatePlanning(qc);
      },
    }),
  };
}

// ---- Focus timer -----------------------------------------------------------------------------

/** The block whose timer is running for this account, on any device; null when none is. */
export function useRunningTimer() {
  return useQuery({
    queryKey: keys.timer,
    queryFn: async ({ signal }) => {
      const snapshot = await api<TimerSnapshot | undefined>("/timer", { signal });
      if (!snapshot) return null;
      syncServerClock(snapshot.serverNow);
      return snapshot.block;
    },
    // Cheap and important: a timer paused or stopped on another device should show here quickly.
    staleTime: 5_000,
    refetchOnWindowFocus: "always",
    refetchInterval: (query) => (query.state.data ? 60_000 : false),
  });
}

export function useTimerMutations() {
  const qc = useQueryClient();
  const apply = (snapshot: TimerSnapshot) => {
    syncServerClock(snapshot.serverNow);
    storeBlock(qc, snapshot.block);
    qc.setQueryData(keys.timer, snapshot.block.timerStartedAt ? snapshot.block : null);
  };
  const settle = () => {
    invalidatePlanning(qc);
    qc.invalidateQueries({ queryKey: keys.timer });
  };
  const closing = () => {
    settle();
    qc.invalidateQueries({ queryKey: keys.days.all });
    qc.invalidateQueries({ queryKey: keys.backlog });
  };
  const post = (path: string, body?: unknown) => api<TimerSnapshot>(path, { method: "POST", body });
  return {
    start: useMutation({
      scope: BLOCK_WRITES,
      mutationFn: ({ blockId, pauseRunning = false }: { blockId: string; pauseRunning?: boolean }) => post(`/blocks/${blockId}/timer/start`, { pauseRunning }),
      onSuccess: apply,
      onSettled: settle,
    }),
    pause: useMutation({ scope: BLOCK_WRITES, mutationFn: (blockId: string) => post(`/blocks/${blockId}/timer/pause`), onSuccess: apply, onSettled: settle }),
    extend: useMutation({
      scope: BLOCK_WRITES,
      mutationFn: ({ blockId, minutes }: { blockId: string; minutes: number }) => post(`/blocks/${blockId}/timer/extend`, { minutes }),
      onSuccess: apply,
      onSettled: settle,
    }),
    stop: useMutation({
      scope: BLOCK_WRITES,
      mutationFn: ({ blockId, outcome, note }: { blockId: string; outcome: StopOutcome; note?: string }) => post(`/blocks/${blockId}/timer/stop`, { outcome, note }),
      onSuccess: apply,
      onSettled: closing,
    }),
  };
}

// ---- Routines, commitments, preferences (P2-C) ----------------------------------------------

export function useRoutines() {
  return useQuery({ queryKey: keys.routines, queryFn: ({ signal }) => api<Routine[]>("/routines", { signal }), staleTime: STALE.reference });
}

/** Routine occurrences for the week containing the date, expanded by the server in the account's zone. */
export function useCommitments(anyDateInWeek: string) {
  const start = weekStart(anyDateInWeek);
  return useQuery({
    // A day early, so an overnight routine that began the evening before is included.
    queryKey: keys.commitments.week(start),
    queryFn: ({ signal }) => api<Commitment[]>(`/commitments?from=${addDays(start, -1)}&to=${addDays(start, 6)}`, { signal }),
    staleTime: STALE.reference,
  });
}

export function useRoutineMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: keys.routines });
    qc.invalidateQueries({ queryKey: keys.commitments.all });
  };
  return {
    create: useMutation({ mutationFn: (body: RoutineInput) => api<Routine>("/routines", { method: "POST", body }), onSuccess: done }),
    update: useMutation({ mutationFn: ({ id, ...body }: Routine) => api<Routine>(`/routines/${id}`, { method: "PUT", body }), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => api(`/routines/${id}`, { method: "DELETE" }), onSuccess: done }),
  };
}

export function usePreferences() {
  return useQuery({ queryKey: keys.preferences, queryFn: ({ signal }) => api<Preferences>("/preferences", { signal }), staleTime: STALE.account });
}

export function useSavePreferences() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Preferences) => api<Preferences>("/preferences", { method: "PUT", body }),
    onSuccess: (saved) => qc.setQueryData(keys.preferences, saved),
  });
}

// ---- Calendars (P2-D) ------------------------------------------------------------------------

export function useCalendarFeed(enabled: boolean) {
  return useQuery({ queryKey: keys.calendarFeed, queryFn: ({ signal }) => api<CalendarFeed>("/calendar/feed", { signal }), enabled, staleTime: Infinity });
}

export function useCalendarConnections() {
  return useQuery({ queryKey: keys.calendarConnections, queryFn: ({ signal }) => api<CalendarConnection[]>("/calendar/connections", { signal }), staleTime: STALE.planning });
}

export function useCalendarMutations() {
  const qc = useQueryClient();
  const changed = (list?: CalendarConnection[]) => {
    if (list) qc.setQueryData(keys.calendarConnections, list);
    else qc.invalidateQueries({ queryKey: keys.calendarConnections });
    qc.invalidateQueries({ queryKey: keys.commitments.all });
  };
  return {
    regenerateFeed: useMutation({
      mutationFn: () => api<CalendarFeed>("/calendar/feed/regenerate", { method: "POST" }),
      onSuccess: (feed) => qc.setQueryData(keys.calendarFeed, feed),
    }),
    connect: useMutation({ mutationFn: (body: { name: string; url: string }) => api<CalendarConnection>("/calendar/connections", { method: "POST", body }), onSuccess: () => changed() }),
    disconnect: useMutation({ mutationFn: (id: string) => api(`/calendar/connections/${id}`, { method: "DELETE" }), onSuccess: () => changed() }),
    refresh: useMutation({
      mutationFn: (force: boolean) => api<CalendarConnection[]>(`/calendar/connections/refresh${force ? "?force=true" : ""}`, { method: "POST" }),
      onSuccess: changed,
    }),
  };
}
