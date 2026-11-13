# Authentication

Sessions are an encrypted, `HttpOnly`, `SameSite=Lax` cookie issued by ASP.NET Core Identity.
Nothing is kept in `localStorage`, so scripts cannot read the session.

## The three ways in

**Email and password.** Minimum 10 characters. Five wrong attempts lock the account for 10 minutes.

**Google.** Hidden until configured:

1. In Google Cloud Console → *APIs & Services → Credentials*, create an *OAuth client ID* of type
   *Web application*.
2. Add the authorised redirect URI `https://<your-host>/api/auth/external/google/callback`
   (for local development: `http://localhost:5173/api/auth/external/google/callback`).
3. Give the API the two values:

   ```bash
   cd server/src/ManageBagle.Api
   dotnet user-secrets init
   dotnet user-secrets set "Authentication:Google:ClientId" "<id>"
   dotnet user-secrets set "Authentication:Google:ClientSecret" "<secret>"
   ```

   In UAT and production use the environment variables `Authentication__Google__ClientId` and
   `Authentication__Google__ClientSecret`.

A Google sign-in with an email that already has an account is linked to that account. Only
Google-verified addresses are accepted. If the existing account's email was never proven, its
password and authenticator are removed during linking, so nobody can pre-register someone else's
address and keep access to it.

**Two-step verification (MFA).** *Settings → Sign-in & security → Turn on.* Scan the QR code with
any TOTP authenticator app and confirm with a code. Ten single-use recovery codes are shown once.
When it is on, password *and* Google sign-ins both require the code. Turning it off, generating new
recovery codes and deleting the account all ask for the password (or a code) again.

## Password reset email

`/forgot-password` always answers the same way, whether or not the account exists. Configure SMTP
with `Smtp__Host`, `Smtp__Port`, `Smtp__Username`, `Smtp__Password`, `Smtp__From`, and set
`App__PublicUrl` to the site's public address so links point to the right place. Without SMTP the
email is written to the log in Development and an error is logged elsewhere.

## Other protections

- **CSRF** – every state-changing `/api` request must carry the `X-MB-Client` header. Browsers do
  not send custom headers cross-site without a CORS preflight, and the API allows no CORS origins.
- **Rate limiting** – auth endpoints allow 20 requests per minute per IP (`RateLimits__AuthPerMinute`).
- **Headers** – a strict Content-Security-Policy (no inline or third-party scripts), `X-Frame-Options: DENY`,
  `nosniff`, HSTS outside Development, and `Cache-Control: no-store` on API responses.
- **Data isolation** – every query is filtered by the signed-in user's id; the API tests assert that
  one user cannot read, edit or attach to another user's data.

## Known limits

- New email/password accounts are not asked to confirm their address before first use.
- There is no admin UI; a locked-out user without recovery codes needs a database-level reset of
  `TwoFactorEnabled`.
