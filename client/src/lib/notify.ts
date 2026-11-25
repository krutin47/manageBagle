/**
 * Browser notifications, used only when the app is open in a background tab (reminders and "time's
 * up"). Permission is asked for once, right after the person starts something that will want to
 * notify them — never on page load. Notifications while the app is fully closed need Web Push and
 * are not part of this phase.
 */
export const notificationsSupported = () => typeof window !== "undefined" && "Notification" in window;

export async function askForNotificationsOnce(): Promise<void> {
  if (!notificationsSupported() || Notification.permission !== "default") return;
  try {
    if (localStorage.getItem("mb.notify-asked")) return;
    localStorage.setItem("mb.notify-asked", "1");
  } catch {
    /* storage blocked: ask anyway, once per visit */
  }
  await Notification.requestPermission().catch(() => undefined);
}

/** Shows a system notification if the tab is hidden and permission was given. Returns whether it did. */
export function notifyInBackground(title: string, body: string, tag: string): boolean {
  if (!notificationsSupported() || Notification.permission !== "granted" || document.visibilityState === "visible") return false;
  try {
    const n = new Notification(title, { body, tag, icon: "/favicon.svg" });
    n.onclick = () => {
      window.focus();
      n.close();
    };
    return true;
  } catch {
    return false; // some browsers only allow notifications from a service worker
  }
}
