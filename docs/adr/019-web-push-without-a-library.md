# ADR-019: Notifications while the app is closed use standard Web Push, built in

- **Status:** Accepted — implemented
- **Date:** 2026-11-25
- **Source:** product owner: "We do need it as we might create a mobile app as well"; P2-C5

## Decision

- **Standard Web Push** (RFC 8030) with message encryption (RFC 8291) and sender identification
  (VAPID, RFC 8292), written on .NET's built-in cryptography (ECDH P-256, HKDF, AES-GCM, ECDSA) in
  `Infrastructure/Push/WebPushCrypto.cs` — about 100 lines, verified byte for byte against the
  RFC 8291 worked example. No third-party library.
- **Keys:** the app creates its VAPID key pair on first use and stores it in the database, the
  private half encrypted with the data-protection key ring. Nothing to configure.
- **Subscriptions:** one row per browser, only on the browsers' own push services (Google, Mozilla,
  Apple, Microsoft); anything else is refused, so the server never posts to an arbitrary or internal
  address. Deleted when the push service says the browser is gone, at sign-out on that browser, and
  with the account.
- **What is sent:** water, meal and time's-up reminders, by the same rules as the in-app reminders.
  Payloads are encrypted to the browser; the push service sees only that a message was sent.
- **Exactly once:** a background job runs every minute on every instance; each reminder is recorded
  in `PushDeliveries` with a unique key before it is sent, so concurrent instances or a restart never
  send it twice. Records older than two days are deleted.
- **Browser side:** `public/sw.js` shows the notification unless the app is open and visible (then
  the in-app toast shows it), and opens the app when the notification is clicked. A web app manifest
  makes the app installable; on iPhone and iPad notifications work once it is added to the Home
  Screen (iOS 16.4+).
- **A future mobile app** would add a delivery channel (APNs or Firebase) next to Web Push; the
  scheduling and the "send once" record stay the same.

## Alternatives rejected

A Web Push library (`WebPush` NuGet: unmaintained since 2021); Firebase Cloud Messaging for the web
(a Google account and SDK for what the standard does); polling from the browser (does not work when
the app is closed).
