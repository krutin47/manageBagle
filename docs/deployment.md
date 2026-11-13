# Deployment

The `Dockerfile` builds one image: the API, with the compiled client in `wwwroot`. It listens on
port 8080 and expects to sit behind a TLS-terminating reverse proxy or platform load balancer.

## Configuration

All settings are environment variables (double underscore = nesting).

| Variable | Required | Notes |
|---|---|---|
| `ASPNETCORE_ENVIRONMENT` | yes | `UAT` or `Production`. Anything but `Development` forces `Secure` cookies and HSTS. |
| `ConnectionStrings__Default` | yes | PostgreSQL, e.g. `Host=…;Database=managebagle;Username=…;Password=…;SSL Mode=Require` |
| `App__PublicUrl` | yes | e.g. `https://app.example.com` – used in emailed links |
| `Authentication__Google__ClientId` / `…ClientSecret` | no | enables Google sign-in |
| `Smtp__Host`, `Smtp__Port`, `Smtp__Username`, `Smtp__Password`, `Smtp__From` | recommended | password-reset email |
| `Database__MigrateOnStartup` | no | default `true`. Set `false` if you run more than one instance and apply migrations as a release step. |
| `RateLimits__AuthPerMinute` | no | default `20` |

Use a **separate database and separate Google OAuth client** for UAT and production.

Health endpoint: `GET /healthz` (checks the database). The image also has a Docker `HEALTHCHECK`.

### Things to know

- The cookie-encryption keys are stored in the database, so restarts and multiple instances keep
  users signed in.
- The app trusts `X-Forwarded-For` / `X-Forwarded-Proto` from whatever is in front of it. Do not
  expose port 8080 directly to the internet; put it behind your proxy.
- Applying a schema change by hand:
  `dotnet ef database update --project server/src/ManageBagle.Api` (after `dotnet tool restore` in `server/`).

## Branch flow

`feature/*` → `dev` → `uat` → `main`. Promote by pull request only; `main` should always be
deployable.

### Protecting `uat` and `main`

Branch protection needs repository-admin rights. Either run:

```bash
./scripts/protect-branches.sh krutin47/manageBagle
```

or set it by hand in *GitHub → Settings → Branches → Add branch ruleset* for `main` and `uat`:
require a pull request with 1 approval, require the three CI checks to pass, require conversations
to be resolved, block force pushes and deletions.

The required check names only become selectable after CI has run once on a pull request.
