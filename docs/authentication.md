# Authentication

Sessions are an encrypted, `HttpOnly`, `SameSite=Lax` cookie issued by ASP.NET Core Identity.
Nothing is kept in `localStorage`, so scripts cannot read the session. A session ends after 14 days
without a visit, and after 30 days regardless (`Auth__IdleSessionDays`, `Auth__AbsoluteSessionDays`).

## Email confirmation

A new account cannot sign in until its owner opens the link sent to their address (valid 2 hours).
Registration always answers the same way, so it cannot be used to discover who has an account; if
the address is already registered, its owner gets an email saying so. A sign-in attempt on an
unconfirmed account offers a new link, but only after the correct password.

**Locally**, with no SMTP configured, emails are printed in the API console and written to
`server/src/ManageBagle.Api/.mail/`.

## The ways in

**Email and password.** Minimum 10 characters. Five wrong attempts lock the account for 10 minutes.

**Google.** Hidden until configured:

1. In Google Cloud Console → *APIs & Services → Credentials*, create an *OAuth client ID* of type
   *Web application*.
2. Add the authorised redirect URI `https://<your-host>/api/auth/external/google/callback`
   (for local development: `http://localhost:5173/api/auth/external/google/callback`).
3. Set `Authentication:Google:ClientId` and `Authentication:Google:ClientSecret` (user-secrets
   locally; `Authentication__Google__…` environment variables elsewhere).

**Microsoft.** Same pattern: register a web app in the Azure portal with the redirect URI
`https://<your-host>/api/auth/external/microsoft/callback`, then set
`Authentication:Microsoft:ClientId` / `ClientSecret`.

Use a **separate OAuth client per environment**.

### How an outside account meets a manageBagle account (ADR-007)

- It can **start a new account**. Google proves the email per sign-in, so the account is usable at
  once; Microsoft does not, so the account confirms by email first.
- It can be **connected to an existing account only by that account's signed-in owner**, in
  *Settings → Sign-in & security → Connect*, after re-entering the password or an authenticator code.
- A sign-in whose email merely matches an existing account is **refused and changes nothing**.
- The last remaining way to sign in cannot be disconnected.

**Adding SSO later.** Providers are listed in one place (`ExternalProviders`) with a flag for
whether their email claim can be trusted. An OpenID Connect provider is one more entry plus its
registration in `Program.cs`.

**Two-step verification (MFA).** *Settings → Sign-in & security → Turn on.* Scan the QR code with
any TOTP authenticator app and confirm with a code. Ten single-use recovery codes are shown once.
When it is on, password, Google and Microsoft sign-ins all require the code. Turning it off, generating new
recovery codes and deleting the account all ask for the password (or a code) again.

## Password reset email

`/forgot-password` always answers the same way, whether or not the account exists. Configure SMTP
with `Smtp__Host`, `Smtp__Port`, `Smtp__Username`, `Smtp__Password`, `Smtp__From`, and set
`App__PublicUrl` to the site's public address so links point to the right place. Without SMTP the
email is written to the log in Development and an error is logged elsewhere.

## Other protections

- **CSRF** (ADR-006) – a state-changing request needs the app's custom header, an `Origin` that is
  this site, and an antiforgery token bound to the browser and the signed-in account.
- **Rate limiting** – auth endpoints allow 20 requests per minute per IP (`RateLimits__AuthPerMinute`).
  This is per instance; with more than one replica, enforce limits at the ingress.
- **Headers** – a strict Content-Security-Policy, `X-Frame-Options: DENY`, `nosniff`, HSTS outside
  Development, and `Cache-Control: no-store` on API responses.
- **Data isolation** – every query is filtered by the signed-in user's id, and ids sent by the client
  are checked for ownership.
- **Audit trail** – account events (sign-in, password change, MFA on/off, account linked/unlinked) are
  written as structured log entries under the `ManageBagle.Audit` category, without credentials.

## Known limits

- There is no admin process for someone locked out of MFA without recovery codes; today that needs
  a database change, which the handbook says must be replaced by an audited procedure.
- Audit events live in logs, not in a table the app can query.
- Sessions on other devices cannot be listed or revoked individually; changing the password ends them.
