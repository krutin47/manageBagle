// Generated from docs/api/openapi.json by scripts/api-types.mjs — do not edit. Run `npm run gen:api`.

export interface AccountExport {
  exportedAt: string;
  profile: ExportProfile;
  preferences: ExportPreferences;
  focusAreas: AreaResponse[];
  dayThemes: ThemeResponse[];
  routines: RoutineResponse[];
  tasks: TaskResponse[];
  blocks: BlockResponse[];
  topThree: ExportOutcome[];
  reviews: ExportReview[];
  connectedCalendars: ExportCalendar[];
  activity: AuditEventResponse[];
}

export interface AreaRequest {
  name: string;
  color: string;
  breakMinutes?: number;
  breakPlacement?: BreakPlacement;
}

export interface AreaResponse {
  id: string;
  name: string;
  color: string;
  sortOrder: number;
  breakMinutes: number;
  breakPlacement: BreakPlacement;
}

export interface AreaSummary {
  focusAreaId: string | null;
  plannedMinutes: number;
  loggedMinutes: number;
  shareOfPlan: number;
}

export interface AuditEventResponse {
  event: string;
  detail: string;
  at: string;
}

export interface BlockProgressRequest {
  status: null | ItemStatus;
  actualMinutes: number | null;
  clearActual: boolean;
  version?: number | null;
}

export interface BlockRequest {
  date: string;
  start: string;
  end: string;
  title: string;
  focusAreaId: string | null;
  priority: Priority;
  workMode: WorkMode;
  status: ItemStatus;
  actualMinutes: number | null;
  notes: string | null;
  isOutside?: boolean;
  version?: number | null;
  breakBeforeMinutes?: number;
  breakAfterMinutes?: number;
}

export interface BlockResponse {
  id: string;
  date: string;
  start: string;
  end: string;
  title: string;
  focusAreaId: string | null;
  priority: Priority;
  workMode: WorkMode;
  status: ItemStatus;
  actualMinutes: number | null;
  plannedMinutes: number;
  varianceMinutes: number | null;
  notes: string;
  isOutside: boolean;
  backlogTaskId: string | null;
  timeZone: string | null;
  version: number;
  timerStartedAt: string | null;
  trackedSeconds: number;
  extendedMinutes: number;
  stopNote: string;
  breakBeforeMinutes: number;
  breakAfterMinutes: number;
  firstStartedAt: string | null;
  finishedAt: string | null;
}

export type BreakPlacement = "After" | "Before";

export interface CalendarConnectionResponse {
  id: string;
  name: string;
  host: string;
  lastFetchedAt: string | null;
  lastError: string;
  eventCount: number;
}

export interface CalendarFeedResponse {
  url: string;
  webcalUrl: string;
}

export interface CaptureItem {
  title: string;
  estimatedMinutes: number | null;
  focusAreaId: string | null;
  workMode: WorkMode;
  isOutside: boolean;
  priority: Priority;
  impact: Priority;
  dueDate: string | null;
  breakMinutes: number | null;
}

export interface CaptureRequest {
  items: CaptureItem[];
}

export interface ChangePasswordRequest {
  currentPassword: string | null;
  newPassword: string;
}

export interface ClientErrorReport {
  kind: string;
  message: string;
  route: string | null;
  reference: string | null;
  release: string | null;
}

export interface CodeRequest {
  code: string;
}

export interface CommitmentResponse {
  kind: string;
  sourceId: string;
  title: string;
  date: string;
  start: string;
  end: string;
  minutes: number;
  taskPolicy: TaskPolicy;
  areaIds: string[];
  isMeal: boolean;
  color: string | null;
}

export interface ConfirmEmailRequest {
  userId: string;
  token: string;
}

export interface ConfirmRequest {
  password: string | null;
  code: string | null;
}

export interface ConnectCalendarRequest {
  name: string | null;
  url: string;
}

export interface CsrfResponse {
  token: string | null;
}

export type DayOfWeek = "Sunday" | "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday" | "Saturday";

export interface DayResponse {
  date: string;
  outcomes: OutcomeResponse[];
  review: ReviewResponse;
}

export interface DaySummary {
  date: string;
  plannedMinutes: number;
  loggedMinutes: number;
  deepFocusMinutes: number;
  blocks: number;
  blocksDone: number;
  doneRate: number | null;
}

export interface ExportCalendar {
  name: string;
  host: string;
  lastFetchedAt: string | null;
  eventCount: number;
}

export interface ExportOutcome {
  date: string;
  outcome: OutcomeResponse;
}

export interface ExportPreferences {
  dayStart: string | null;
  dayEnd: string | null;
  waterReminderMinutes: number | null;
  breakColor: string | null;
}

export interface ExportProfile {
  email: string;
  displayName: string;
  timeZone: string | null;
  createdAt: string;
  twoStepVerification: boolean;
  signInProviders: string[];
}

export interface ExportReview {
  date: string;
  biggestWin: string;
  interruptions: string;
  changeTomorrow: string;
}

export interface ForgotPasswordRequest {
  email: string;
}

export interface HttpValidationProblemDetails {
  type?: string | null;
  title?: string | null;
  status?: number | null;
  detail?: string | null;
  instance?: string | null;
  errors?: Record<string, string[]>;
}

export type ItemStatus = "Planned" | "InProgress" | "Done" | "Skipped";

export interface LinkStartResponse {
  url: string;
}

export interface LoginRequest {
  email: string;
  password: string;
  rememberMe: boolean;
}

export interface MfaLoginRequest {
  code: string;
  useRecoveryCode: boolean;
  rememberDevice: boolean;
}

export interface MfaResetResponse {
  status: string;
  availableAt: string | null;
}

export interface MfaResetStateResponse {
  state: string;
  availableAt: string | null;
}

export interface MfaSetupResponse {
  sharedKey: string;
  otpauthUri: string;
}

export interface OutcomeRequest {
  result: string;
  focusAreaId: string | null;
  nextAction: string | null;
  status: ItemStatus;
  minutesNeeded: number | null;
}

export interface OutcomeResponse {
  rank: number;
  result: string;
  focusAreaId: string | null;
  nextAction: string;
  status: ItemStatus;
  minutesNeeded: number | null;
  backlogTaskId: string | null;
}

export interface PlanItem {
  taskId: string | null;
  title: string;
  estimatedMinutes: number;
  focusAreaId: string | null;
  workMode: WorkMode;
  isOutside: boolean;
  priority: Priority;
  topRank: number | null;
  start: string | null;
  end: string | null;
  impact?: Priority;
  dueDate?: string | null;
  breakBeforeMinutes?: number;
  breakAfterMinutes?: number;
  breakMinutes?: number | null;
}

export interface PlanRequest {
  items: PlanItem[];
}

export interface PlanResponse {
  tasksCreated: number;
  blocksBooked: number;
  leftInBacklog: number;
  outcomes: OutcomeResponse[];
}

export interface PreferencesRequest {
  dayStart: string;
  dayEnd: string;
  waterReminderMinutes: number | null;
  breakColor?: string | null;
}

export interface PreferencesResponse {
  dayStart: string;
  dayEnd: string;
  waterReminderMinutes: number | null;
  breakColor: string | null;
}

export type Priority = "High" | "Medium" | "Low";

export interface ProblemDetails {
  type?: string | null;
  title?: string | null;
  status?: number | null;
  detail?: string | null;
  instance?: string | null;
}

export interface ProfileRequest {
  displayName: string;
  timeZone?: string | null;
}

export interface RecoveryCodesResponse {
  recoveryCodes: string[];
}

export interface RegisterRequest {
  email: string;
  password: string;
  displayName: string;
  timeZone?: string | null;
}

export interface ReorderRequest {
  ids: string[];
}

export interface ResetPasswordRequest {
  email: string;
  token: string;
  newPassword: string;
}

export interface ReviewRequest {
  biggestWin: string | null;
  interruptions: string | null;
  changeTomorrow: string | null;
}

export interface ReviewResponse {
  biggestWin: string;
  interruptions: string;
  changeTomorrow: string;
}

export interface RoutineRequest {
  title: string;
  days: Weekdays;
  start: string;
  end: string;
  taskPolicy: TaskPolicy;
  areaIds: string[] | null;
  isMeal?: boolean;
  color?: string | null;
}

export interface RoutineResponse {
  id: string;
  title: string;
  days: Weekdays;
  start: string;
  end: string;
  taskPolicy: TaskPolicy;
  areaIds: string[];
  isMeal: boolean;
  color: string | null;
}

export interface ScheduleRequest {
  date: string;
  start: string;
  end: string;
  workMode: WorkMode;
}

export interface ScheduledTaskResponse {
  task: TaskResponse;
  block: BlockResponse;
}

export interface StatusResponse {
  status: string;
}

export type StopOutcome = "Finished" | "Later" | "Drop";

export type TaskPolicy = "NoTasks" | "AnyTask" | "SelectedAreas";

export interface TaskRequest {
  title: string;
  focusAreaId: string | null;
  estimatedMinutes: number | null;
  priority: Priority;
  dueDate: string | null;
  status: ItemStatus;
  nextStep: string | null;
  workMode?: WorkMode;
  isOutside?: boolean;
  impact?: Priority;
  version?: number | null;
  breakMinutes?: number | null;
}

export interface TaskResponse {
  id: string;
  title: string;
  focusAreaId: string | null;
  estimatedMinutes: number | null;
  priority: Priority;
  dueDate: string | null;
  status: ItemStatus;
  nextStep: string;
  workMode: WorkMode;
  isOutside: boolean;
  impact: Priority;
  scheduledDate: string | null;
  createdAt: string;
  version: number;
  breakMinutes: number | null;
}

export interface ThemeRequest {
  primaryFocus: string | null;
  outcome: string | null;
  review: string | null;
}

export interface ThemeResponse {
  day: DayOfWeek;
  primaryFocus: string;
  outcome: string;
  review: string;
}

export interface TimerExtendRequest {
  minutes: number;
}

export interface TimerResponse {
  block: BlockResponse;
  serverNow: string;
  pausedBlockId: string | null;
}

export interface TimerStartRequest {
  pauseRunning?: boolean;
}

export interface TimerStopRequest {
  outcome: StopOutcome;
  note: string | null;
}

export interface TokenRequest {
  token: string;
}

export interface UserResponse {
  id: string;
  email: string;
  displayName: string;
  timeZone: string | null;
  mfaEnabled: boolean;
  hasPassword: boolean;
  googleLinked: boolean;
  microsoftLinked: boolean;
  recoveryCodesLeft: number;
}

export interface WeekSummaryResponse {
  start: string;
  totals: WeekTotals;
  days: DaySummary[];
  areas: AreaSummary[];
}

export interface WeekTotals {
  plannedMinutes: number;
  loggedMinutes: number;
  deepFocusMinutes: number;
  blocks: number;
  blocksDone: number;
  doneRate: number | null;
}

export type Weekdays = string;

export type WorkMode = "DeepFocus" | "ShallowWork" | "Meeting" | "Personal";
