import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, type Area, type AreaColor, type Block, type BlockInput, type Day, type DayName, type Outcome, type Review, type Status, type Task, type TaskInput, type Theme, type User, type WeekSummary, type WorkMode } from "./api";
import { addDays, weekStart } from "./time";

const withSeconds = (t: string) => (t.length === 5 ? `${t}:00` : t);

// ---- Session ---------------------------------------------------------------------------------

export function useMe() {
  return useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<User>("/auth/me");
      } catch (e) {
        if ((e as { status?: number }).status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
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
  return useQuery({ queryKey: ["providers"], queryFn: () => api<{ google: boolean }>("/auth/providers"), staleTime: Infinity });
}

// ---- Focus areas -----------------------------------------------------------------------------

export function useAreas() {
  return useQuery({ queryKey: ["areas"], queryFn: () => api<Area[]>("/areas"), staleTime: 60_000 });
}

export function useAreaMutations() {
  const qc = useQueryClient();
  const done = () => {
    qc.invalidateQueries({ queryKey: ["areas"] });
    qc.invalidateQueries({ queryKey: ["week"] });
  };
  return {
    create: useMutation({ mutationFn: (body: { name: string; color: AreaColor }) => api<Area>("/areas", { method: "POST", body }), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...body }: { id: string; name: string; color: AreaColor }) => api<Area>(`/areas/${id}`, { method: "PUT", body }),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api(`/areas/${id}`, { method: "DELETE" }),
      onSuccess: () => {
        done();
        invalidatePlanning(qc);
        qc.invalidateQueries({ queryKey: ["backlog"] });
        qc.invalidateQueries({ queryKey: ["day"] });
      },
    }),
  };
}

// ---- Time blocks -----------------------------------------------------------------------------

/** Blocks are always fetched a whole week (Mon–Sun) at a time so Today, Planner and Week share one cache. */
export function useWeekBlocks(anyDateInWeek: string) {
  const start = weekStart(anyDateInWeek);
  return useQuery({
    queryKey: ["blocks", start],
    queryFn: () => api<Block[]>(`/blocks?from=${start}&to=${addDays(start, 6)}`),
    staleTime: 30_000,
    placeholderData: (previous, query) => (query?.queryKey[1] === start ? previous : undefined),
  });
}

function invalidatePlanning(qc: QueryClient) {
  qc.invalidateQueries({ queryKey: ["blocks"] });
  qc.invalidateQueries({ queryKey: ["week"] });
}

const blockBody = (b: BlockInput) => ({ ...b, start: withSeconds(b.start), end: withSeconds(b.end) });

export function useBlockMutations() {
  const qc = useQueryClient();
  const settle = () => {
    invalidatePlanning(qc);
    qc.invalidateQueries({ queryKey: ["backlog"] });
  };
  return {
    create: useMutation({ mutationFn: (b: BlockInput) => api<Block>("/blocks", { method: "POST", body: blockBody(b) }), onSuccess: settle }),
    update: useMutation({
      mutationFn: ({ id, ...b }: BlockInput & { id: string }) => api<Block>(`/blocks/${id}`, { method: "PUT", body: blockBody(b) }),
      onSuccess: settle,
    }),
    /** Optimistic: ticking a block off should feel instant. */
    progress: useMutation({
      mutationFn: ({ block, ...body }: { block: Block; status?: Status; actualMinutes?: number; clearActual?: boolean }) =>
        api<Block>(`/blocks/${block.id}/progress`, { method: "PATCH", body }),
      onMutate: async ({ block, status, actualMinutes, clearActual }) => {
        const key = ["blocks", weekStart(block.date)];
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
      onError: (_e, _v, ctx) => ctx && qc.setQueryData(ctx.key, ctx.previous),
      onSettled: settle,
    }),
    remove: useMutation({ mutationFn: (id: string) => api(`/blocks/${id}`, { method: "DELETE" }), onSuccess: settle }),
  };
}

export function useWeekSummary(start: string) {
  return useQuery({
    queryKey: ["week", start],
    queryFn: () => api<WeekSummary>(`/summary/week?start=${start}`),
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
}

// ---- Daily focus -----------------------------------------------------------------------------

export function useDay(date: string) {
  return useQuery({ queryKey: ["day", date], queryFn: () => api<Day>(`/days/${date}`), staleTime: 30_000 });
}

export function useDayMutations(date: string) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["day", date] });
  return {
    saveOutcome: useMutation({
      mutationFn: ({ rank, ...body }: Outcome) => api<Outcome>(`/days/${date}/outcomes/${rank}`, { method: "PUT", body }),
      onMutate: async (next) => {
        await qc.cancelQueries({ queryKey: ["day", date] });
        const previous = qc.getQueryData<Day>(["day", date]);
        qc.setQueryData<Day>(["day", date], (d) =>
          d && { ...d, outcomes: [...d.outcomes.filter((o) => o.rank !== next.rank), next].sort((a, b) => a.rank - b.rank) },
        );
        return { previous };
      },
      onError: (_e, _v, ctx) => qc.setQueryData(["day", date], ctx?.previous),
      onSettled: done,
    }),
    removeOutcome: useMutation({ mutationFn: (rank: number) => api(`/days/${date}/outcomes/${rank}`, { method: "DELETE" }), onSuccess: done }),
    saveReview: useMutation({
      mutationFn: (body: Review) => api<Review>(`/days/${date}/review`, { method: "PUT", body }),
      onSuccess: (review) => qc.setQueryData<Day>(["day", date], (d) => d && { ...d, review }),
    }),
  };
}

export function useThemes() {
  return useQuery({ queryKey: ["themes"], queryFn: () => api<Theme[]>("/themes"), staleTime: 5 * 60_000 });
}

export function useSaveTheme() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ day, ...body }: Theme) => api<Theme>(`/themes/${day satisfies DayName}`, { method: "PUT", body }),
    onSuccess: (saved) => qc.setQueryData<Theme[]>(["themes"], (list) => list?.map((t) => (t.day === saved.day ? saved : t))),
  });
}

// ---- Backlog ---------------------------------------------------------------------------------

export function useBacklog() {
  return useQuery({ queryKey: ["backlog"], queryFn: () => api<Task[]>("/backlog"), staleTime: 30_000 });
}

export function useTaskMutations() {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["backlog"] });
  return {
    create: useMutation({ mutationFn: (body: TaskInput) => api<Task>("/backlog", { method: "POST", body }), onSuccess: done }),
    update: useMutation({
      mutationFn: ({ id, ...body }: TaskInput & { id: string }) => api<Task>(`/backlog/${id}`, { method: "PUT", body }),
      onMutate: async (next) => {
        await qc.cancelQueries({ queryKey: ["backlog"] });
        const previous = qc.getQueryData<Task[]>(["backlog"]);
        qc.setQueryData<Task[]>(["backlog"], (list) => list?.map((t) => (t.id === next.id ? { ...t, ...next } : t)));
        return { previous };
      },
      onError: (_e, _v, ctx) => qc.setQueryData(["backlog"], ctx?.previous),
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
