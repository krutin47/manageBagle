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
| `Authentication__Microsoft__ClientId` / `…ClientSecret` | no | enables Microsoft sign-in |
| `Smtp__Host`, `Smtp__Port`, `Smtp__Username`, `Smtp__Password`, `Smtp__From` | recommended | password-reset email |
| `Database__MigrateOnStartup` | no | default `false`. Run migrations as a release step: `<image> --migrate`. `true` is for development. |
| `ForwardedHeaders__KnownProxies`, `…__KnownNetworks` | **yes behind a proxy** | comma-separated IPs / CIDRs of your ingress. Only loopback is trusted by default; without this the app sees every request as plain HTTP and refuses writes. |
| `AllowedHosts` | recommended | your public host name(s) |
| `Security__AllowedOrigins__0` | no | extra origins allowed to send writes (normally none) |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | no | turns on trace and metric export to a collector |
| `Auth__IdleSessionDays`, `Auth__AbsoluteSessionDays` | no | default 14 and 30 |
| `Auth__SessionRevalidateSeconds` | no | default 60: how soon a password change ends other sessions |
| `Auth__MfaResetDelayHours` | no | default 72: wait before a lost-second-factor recovery can finish |
| `RateLimits__AuthPerMinute` | no | default `20` |

Use a **separate database and separate Google OAuth client** for UAT and production.

Probes: `/health/live` (process up) and `/health/ready` (database reachable and schema current).
The image's Docker `HEALTHCHECK` uses liveness. Release, rollback and backup steps are in
[runbooks/](runbooks/).

### Things to know

- The cookie-encryption keys are stored in the database, so restarts and multiple instances keep
  users signed in.
- Do not expose port 8080 to the internet. TLS ends at your ingress, and the app trusts
  `X-Forwarded-*` only from the addresses you list (see the table above).
- Logs are JSON, one line per event, with a trace id that also appears in error responses.
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
