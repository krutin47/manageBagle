/**
 * Compile-time contract check (handbook Phase 2, "generated TypeScript contracts"; ADR-016).
 *
 * The client's types in api.ts are written by hand because they are narrower than the contract
 * (e.g. a colour is one of eight names, not any string). This file proves they still describe the
 * same fields, nullability and optionality as the types generated from docs/api/openapi.json:
 * when the API changes and the client is not updated, `npm run typecheck` fails here.
 * Nothing in this file runs.
 */
import type * as Api from "./api";
import type * as Contract from "./api.generated";

/** Forget literal narrowing (enums, colours) so only the shape is compared. */
type Widen<T> = T extends string
  ? string
  : T extends number
    ? number
    : T extends boolean
      ? boolean
      : T extends readonly (infer U)[]
        ? Widen<U>[]
        : T extends object
          ? { [K in keyof T]: Widen<T[K]> }
          : T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type Matches<Client, Server> = Same<Widen<Client>, Widen<Server>>;
/** A request may fill in fields the server would default, but may not send fields the server does not know. */
type Sends<Client, Server> = [Widen<Client>] extends [Widen<Server>]
  ? [Exclude<keyof Client, keyof Server>] extends [never]
    ? true
    : false
  : false;

// Responses: what the client reads.
export type Checks = [
  Assert<Matches<Api.User, Contract.UserResponse>>,
  Assert<Matches<Api.Task, Contract.TaskResponse>>,
  Assert<Matches<Api.Block, Contract.BlockResponse>>,
  Assert<Matches<Api.Area, Contract.AreaResponse>>,
  Assert<Matches<Api.Routine, Contract.RoutineResponse>>,
  Assert<Matches<Api.Commitment, Contract.CommitmentResponse>>,
  Assert<Matches<Api.Preferences, Contract.PreferencesResponse>>,
  Assert<Matches<Api.Outcome, Contract.OutcomeResponse>>,
  Assert<Matches<Api.TimerSnapshot, Contract.TimerResponse>>,
  Assert<Matches<Api.CalendarConnection, Contract.CalendarConnectionResponse>>,
  Assert<Matches<Api.CalendarFeed, Contract.CalendarFeedResponse>>,
  Assert<Matches<Api.Day, Contract.DayResponse>>,
  Assert<Matches<Api.Theme, Contract.ThemeResponse>>,
  Assert<Matches<Api.WeekSummary, Contract.WeekSummaryResponse>>,
  Assert<Matches<Api.AiStatus, Contract.AiStatus>>,
  Assert<Matches<Api.TaskSuggestion, Contract.TaskSuggestion>>,
  // Requests: what the client sends.
  Assert<Sends<Api.PlanItem, Contract.PlanItem>>,
  Assert<Sends<Api.CaptureItem, Contract.CaptureItem>>,
  Assert<Sends<Api.RoutineInput, Contract.RoutineRequest>>,
  Assert<Sends<Api.Preferences, Contract.PreferencesRequest>>,
];
