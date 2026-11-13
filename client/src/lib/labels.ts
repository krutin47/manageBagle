import type { AreaColor, Priority, Status, WorkMode } from "./api";

export const STATUSES: Status[] = ["Planned", "InProgress", "Done", "Skipped"];
export const PRIORITIES: Priority[] = ["High", "Medium", "Low"];
export const WORK_MODES: WorkMode[] = ["DeepFocus", "ShallowWork", "Meeting", "Personal"];
export const AREA_COLORS: AreaColor[] = ["teal", "blue", "violet", "rose", "orange", "amber", "green", "slate"];

export const statusLabel: Record<Status, string> = { Planned: "Planned", InProgress: "In progress", Done: "Done", Skipped: "Skipped" };
export const modeLabel: Record<WorkMode, string> = { DeepFocus: "Deep focus", ShallowWork: "Shallow work", Meeting: "Meeting", Personal: "Personal" };
export const colorLabel: Record<AreaColor, string> = {
  teal: "Teal", blue: "Blue", violet: "Violet", rose: "Rose", orange: "Orange", amber: "Amber", green: "Green", slate: "Slate",
};
