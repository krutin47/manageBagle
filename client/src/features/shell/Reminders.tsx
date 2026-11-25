import { useEffect, useMemo, useRef } from "react";
import { useToast } from "../../components/toast";
import { commitmentsOn } from "../../lib/commitments";
import { notifyInBackground } from "../../lib/notify";
import { useCommitments, usePreferences } from "../../lib/queries";
import { remindersBetween } from "../../lib/reminders";
import { nowMinutes, todayISO, toMinutes } from "../../lib/time";

/** Water and meal reminders while the app is open (P2-C5). Renders nothing. */
export function Reminders() {
  const toast = useToast();
  const prefs = usePreferences();
  const today = todayISO();
  const commitments = useCommitments(today);
  const plan = useMemo(() => prefs.data && {
    dayStart: toMinutes(prefs.data.dayStart),
    dayEnd: toMinutes(prefs.data.dayEnd),
    waterEvery: prefs.data.waterReminderMinutes,
    meals: commitmentsOn(today, commitments.data ?? []).filter((c) => c.source.isMeal && c.start >= 0).map((c) => ({ title: c.title, start: c.start })),
  }, [prefs.data, commitments.data, today]);

  // Start from "now": anything due before the page opened is not shown late.
  const last = useRef({ date: today, minute: nowMinutes() });
  useEffect(() => {
    if (!plan) return;
    const check = () => {
      const date = todayISO();
      const minute = nowMinutes();
      if (date !== last.current.date) last.current = { date, minute: -1 };
      for (const r of remindersBetween(last.current.minute, minute, plan)) {
        if (!notifyInBackground(r.title, r.body, r.key)) toast.info(`${r.title}. ${r.body}`);
      }
      last.current = { date, minute };
    };
    check();
    const id = window.setInterval(check, 20_000);
    return () => window.clearInterval(id);
  }, [plan, toast]);

  return null;
}
