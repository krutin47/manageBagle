import { useEffect } from "react";
import { useCalendarConnections, useCalendarMutations } from "../../lib/queries";

/**
 * Keeps meetings from connected calendars fresh while the app is open: on start, then every 15
 * minutes. The server re-reads a calendar at most every 15 minutes whatever is asked. Renders nothing.
 */
export function CalendarRefresher() {
  const connections = useCalendarConnections();
  const { refresh } = useCalendarMutations();
  const any = (connections.data?.length ?? 0) > 0;
  const { mutate } = refresh;
  useEffect(() => {
    if (!any) return;
    mutate(false);
    const id = window.setInterval(() => mutate(false), 15 * 60_000);
    return () => window.clearInterval(id);
  }, [any, mutate]);
  return null;
}
