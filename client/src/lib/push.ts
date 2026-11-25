import { api } from "./api";

/**
 * Notifications while manageBagle is closed (ADR-019). The service worker (public/sw.js) shows them;
 * this module turns them on and off for the current browser.
 */
export type PushState = "unsupported" | "needs-install" | "blocked" | "off" | "on";

const supported = () => typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
/** iPhone and iPad allow web notifications only for an app added to the Home Screen. */
const isIosBrowserTab = () => /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.matchMedia("(display-mode: standalone)").matches;

const keyBytes = (base64url: string) => {
  const base64 = base64url.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(base64url.length / 4) * 4, "=");
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
};

async function registration() {
  return navigator.serviceWorker.register("/sw.js", { scope: "/" }).then(() => navigator.serviceWorker.ready);
}

/** The Permissions API where available (it is the live value; `Notification.permission` can lag), else the legacy property. */
async function permission(): Promise<NotificationPermission> {
  try {
    const status = await navigator.permissions.query({ name: "notifications" as PermissionName });
    return status.state === "prompt" ? "default" : status.state;
  } catch {
    return Notification.permission;
  }
}

export async function pushState(): Promise<PushState> {
  if (!supported()) return isIosBrowserTab() ? "needs-install" : "unsupported";
  const allowed = await permission();
  if (allowed === "denied") return "blocked";
  const existing = await navigator.serviceWorker.getRegistration("/");
  const subscription = existing ? await existing.pushManager.getSubscription() : null;
  return subscription && allowed === "granted" ? "on" : "off";
}

export async function enablePush(): Promise<PushState> {
  if (!supported()) return "unsupported";
  if ((await permission()) !== "granted" && (await Notification.requestPermission()) !== "granted") return (await permission()) === "denied" ? "blocked" : "off";
  const reg = await registration();
  const { publicKey } = await api<{ publicKey: string }>("/push/key");
  const subscription = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
  await api("/push/subscriptions", { method: "POST", body: subscription.toJSON() });
  return "on";
}

/** Turns notifications off for this browser. Also used at sign-out, so a shared browser stops getting the last person's reminders. */
export async function disablePush(): Promise<void> {
  if (!supported()) return;
  const reg = await navigator.serviceWorker.getRegistration("/");
  const subscription = reg ? await reg.pushManager.getSubscription() : null;
  if (!subscription) return;
  try {
    await api("/push/subscriptions/remove", { method: "POST", body: { endpoint: subscription.endpoint } });
  } finally {
    await subscription.unsubscribe();
  }
}

export const sendTestPush = () => api<{ sent: number; devices: number }>("/push/test", { method: "POST" });
