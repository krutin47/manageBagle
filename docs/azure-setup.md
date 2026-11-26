# Setting up UAT and production on Azure

You never share a password or key with anyone, including Claude: GitHub Actions signs in to Azure
with a short-lived token that Azure trusts only for this repository's `uat` and `production`
environments, and every secret lives in GitHub's encrypted settings. Design: [ADR-017](adr/017-azure-container-apps.md).

**What it costs.** One PostgreSQL server (Burstable B1ms) shared by UAT and production, each with
its own database; Container Apps on the consumption plan (UAT sleeps when unused, production keeps
one small instance). On a new Azure free account the database server is free for 12 months and the
Container Apps free grant covers most of the rest; after that, expect roughly US$25–35 a month.

## 1. Azure (once, about 10 minutes)

1. Create an account at <https://azure.microsoft.com/free> if you do not have one.
2. Open **Cloud Shell** (the `>_` icon at the top of <https://portal.azure.com>), choose **Bash**.
3. Run:

   ```bash
   git clone https://github.com/krutin47/manageBagle.git && cd manageBagle && bash scripts/azure-setup.sh krutin47/manageBagle eastus managebagle
   ```

   Change `eastus` to a region near you (e.g. `canadacentral`, `westeurope`, `centralindia`).
4. Keep the window open: it prints four values and a database password for the next step. The
   password is generated fresh each time the script runs — use the one from the first run only.

## 2. GitHub environments (once)

GitHub → the repository → **Settings → Environments → New environment**: create `uat`, then
`production`. For `production`, tick **Required reviewers** and add yourself, so nothing reaches
production without your click.

In **each** environment add:

| Kind | Name | Value |
|---|---|---|
| Variable | `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP` | from the script |
| Secret | `POSTGRES_ADMIN_PASSWORD` | from the script (same in both) |

Everything below is optional at first; the app runs without it and the related feature stays off.

## 3. First deployment

Open a pull request from `dev` into `uat` and merge it. The **Release** workflow builds the image,
signs it, publishes it to GitHub Packages, creates the Azure resources, applies migrations and
smoke-tests the result. The UAT address appears in the run's summary
(`https://managebagle-uat.<something>.azurecontainerapps.io`).

If the deploy step cannot pull the image, the package is private: GitHub → your profile →
**Packages → managebagle → Package settings → Change visibility → Public** (the code is public
already), then re-run the workflow.

Production: open a pull request from `uat` into `main` and merge it. Nothing is rebuilt — the exact
image UAT ran is verified and deployed, after your approval.

## 4. Email (so new accounts can confirm their address)

The app needs an SMTP account to send mail. A free option that works without owning a domain:
**Brevo** (300 emails a day free).

1. Sign up at <https://www.brevo.com>, then **Senders, Domains & Dedicated IPs → Senders → Add a
   sender** with the address emails should come from, and confirm it.
2. **SMTP & API → SMTP**: note the *SMTP server*, *Port* and *Login*, and **Generate a new SMTP key**.
3. In both GitHub environments:

| Kind | Name | Value |
|---|---|---|
| Variable | `SMTP_HOST` | `smtp-relay.brevo.com` |
| Variable | `SMTP_USERNAME` | the SMTP *Login* |
| Variable | `SMTP_FROM` | the sender address you confirmed |
| Secret | `SMTP_PASSWORD` | the SMTP key |

Later, with your own domain, add it in Brevo (DNS records it shows you) so mail is less likely to
land in spam.

## 5. Google and Microsoft sign-in

You need the UAT and production addresses from step 3 first. Each provider gives you a **client
id** (a variable) and a **client secret** (a secret). Use separate ones for UAT and production.

**Google** — <https://console.cloud.google.com>

1. Create a project → **APIs & Services → OAuth consent screen**: External; app name manageBagle;
   your email; scopes `email`, `profile`, `openid`. Add yourself as a test user while testing.
2. **Credentials → Create credentials → OAuth client ID → Web application**.
   *Authorized redirect URI*: `https://<your UAT address>/api/auth/external/google/callback`
3. Copy the values into the `uat` environment as `GOOGLE_CLIENT_ID` (variable) and
   `GOOGLE_CLIENT_SECRET` (secret). Repeat with the production address for `production`.

**Microsoft** — <https://entra.microsoft.com>

1. **App registrations → New registration**: name manageBagle; *Accounts in any organizational
   directory and personal Microsoft accounts*; Redirect URI (Web):
   `https://<your UAT address>/api/auth/external/microsoft/callback`
2. Copy the *Application (client) ID* → `MICROSOFT_CLIENT_ID` (variable).
3. **Certificates & secrets → New client secret** → copy the *Value* → `MICROSOFT_CLIENT_SECRET`
   (secret). Secrets expire (up to 24 months): note the date. Repeat for production.

Writing into Google Calendar (P2-D3) will later need the Calendar API enabled on the same Google
project; nothing to do for that yet.

## 6. Error monitoring (Sentry, free plan)

1. Sign up at <https://sentry.io> (Developer plan, free).
2. **Create project → ASP.NET Core**, name it `managebagle`.
3. Copy the **DSN** → secret `SENTRY_DSN` in both environments. UAT and production are told apart
   by the environment name the app reports.
4. In Sentry → **Alerts**, keep the default "new issue" email alert.

## 7. AI brain dump (optional, at most US$10 a month)

1. Create an account at <https://console.anthropic.com>, add a payment method.
2. **Settings → Limits → Spend limit: US$10** per month. This is the hard ceiling, enforced by
   Anthropic; the app also stops itself at its own estimate of US$10.
3. **API keys → Create key** → secret `ANTHROPIC_API_KEY` in `production` (and `uat` if you want
   to try it there; both count towards the same US$10).

Without the key, "Turn into tasks" is hidden and the brain dump works as it does today.

**Which model.** The default is Claude Opus 5.5: at roughly US$0.01–0.03 a use, US$10 covers several
hundred uses a month. Claude Haiku 5.5 costs about 1/40th as much (thousands of uses for the same
US$10) and is likely good enough for this simple extraction, though it is a smaller model. To switch,
add the variable `AI_MODEL` = `claude-haiku-5-5` in the environment and redeploy.

## Reference: every setting

| Name | Kind | Needed for |
|---|---|---|
| `AZURE_CLIENT_ID`, `AZURE_TENANT_ID`, `AZURE_SUBSCRIPTION_ID`, `AZURE_RESOURCE_GROUP` | variable | deploying (required) |
| `POSTGRES_ADMIN_PASSWORD` | secret | the database (required) |
| `PUBLIC_URL` | variable | only with a custom domain, e.g. `https://plan.example.com` |
| `SMTP_HOST`, `SMTP_USERNAME`, `SMTP_FROM` / `SMTP_PASSWORD` | variable / secret | email |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | variable / secret | Google sign-in |
| `MICROSOFT_CLIENT_ID` / `MICROSOFT_CLIENT_SECRET` | variable / secret | Microsoft sign-in |
| `SENTRY_DSN` | secret | error monitoring |
| `ANTHROPIC_API_KEY` | secret | AI brain dump |
| `AI_MODEL` | variable | optional: `claude-haiku-5-5` for a cheaper model |
| `GHCR_PULL_TOKEN` | secret | only if the image package stays private |

Settings fixed in the template: logs kept 30 days, database backups 35 days, account activity 13
months, 10 database connections per instance (the B1ms server allows 50).
