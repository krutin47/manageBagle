export interface Reminder {
  key: string;
  kind: "water" | "meal";
  at: number;
  title: string;
  body: string;
}

export interface ReminderPlan {
  dayStart: number;
  dayEnd: number;
  /** Minutes between water reminders; null when off. */
  waterEvery: number | null;
  /** Meal routines today, by start minute. */
  meals: { title: string; start: number }[];
}

/**
 * Reminders due in the half-open window (after, upTo] (P2-C5). Water reminders fall every N minutes
 * from the start of the day, inside the day window; a meal reminder falls when a meal routine starts.
 * Checking from "now" onwards on page load means nothing that already passed is shown again.
 */
export function remindersBetween(after: number, upTo: number, plan: ReminderPlan): Reminder[] {
  const due: Reminder[] = [];
  if (plan.waterEvery) {
    for (let at = plan.dayStart + plan.waterEvery; at < plan.dayEnd; at += plan.waterEvery) {
      if (at > after && at <= upTo) due.push({ key: `water-${at}`, kind: "water", at, title: "Time for some water", body: "A glass of water now keeps the afternoon slump away." });
    }
  }
  for (const meal of plan.meals) {
    if (meal.start > after && meal.start <= upTo) {
      due.push({ key: `meal-${meal.start}-${meal.title}`, kind: "meal", at: meal.start, title: `${meal.title} time`, body: "Step away from the screen. The plan will wait." });
    }
  }
  return due.sort((a, b) => a.at - b.at);
}
