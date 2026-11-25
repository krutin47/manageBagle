// manageBagle service worker: shows reminders when the app is not open (ADR-019).
// It caches nothing and serves no pages; it only receives pushes and opens the app on a click.

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "manageBagle", body: event.data ? event.data.text() : "" };
  }
  event.waitUntil((async () => {
    // When the app is open and visible it shows the same reminder itself, as a toast.
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    if (windows.some((w) => w.visibilityState === "visible")) return;
    await self.registration.showNotification(data.title || "manageBagle", {
      body: data.body || "",
      tag: data.tag,
      icon: "/icons/icon-192.png",
      data: { url: data.url || "/" },
    });
  })());
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/", self.location.origin).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (open) {
      await open.focus();
      return;
    }
    await self.clients.openWindow(url);
  })());
});

// Browsers occasionally replace a subscription; hand the new one to the server (same-origin, signed in).
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil((async () => {
    const key = await fetch("/api/push/key", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null));
    if (!key) return;
    const padded = key.publicKey.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(key.publicKey.length / 4) * 4, "=");
    const subscription = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: Uint8Array.from(atob(padded), (c) => c.charCodeAt(0)) });
    const csrf = await fetch("/api/auth/csrf", { credentials: "same-origin", headers: { "X-MB-Client": "sw" } }).then((r) => r.json());
    await fetch("/api/push/subscriptions", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", "X-MB-Client": "sw", "X-CSRF-TOKEN": csrf.token },
      body: JSON.stringify(subscription.toJSON()),
    });
  })());
});
