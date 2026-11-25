using System.Text.Json.Serialization;
using System.Threading.RateLimiting;
using ManageBagle.Api.Auth;
using ManageBagle.Api.Data;
using ManageBagle.Api.Features;
using ManageBagle.Api.Infrastructure;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.HttpOverrides;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using OpenTelemetry.Metrics;
using OpenTelemetry.Resources;
using OpenTelemetry.Trace;

// `dotnet ManageBagle.Api.dll --healthcheck` lets the container probe itself without curl in the image.
if (args.Contains("--healthcheck"))
{
    using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
    var port = Environment.GetEnvironmentVariable("ASPNETCORE_HTTP_PORTS")?.Split(';')[0] ?? "8080";
    try { return (await http.GetAsync($"http://localhost:{port}/health/live")).IsSuccessStatusCode ? 0 : 1; }
    catch (HttpRequestException) { return 1; }
    catch (TaskCanceledException) { return 1; }
}

const string SessionStartedKey = "mb.started";

var builder = WebApplication.CreateBuilder(args);
var config = builder.Configuration;

// Machine-readable logs everywhere except a developer's terminal.
if (!builder.Environment.IsDevelopment())
{
    builder.Logging.ClearProviders();
    builder.Logging.AddJsonConsole(o =>
    {
        o.IncludeScopes = true;
        o.UseUtcTimestamp = true;
        o.TimestampFormat = "yyyy-MM-ddTHH:mm:ss.fffZ";
    });
}

// Traces and metrics leave the process only when an OTLP collector is configured.
if (!string.IsNullOrWhiteSpace(config["OTEL_EXPORTER_OTLP_ENDPOINT"]))
{
    builder.Services.AddOpenTelemetry()
        .ConfigureResource(r => r.AddService("managebagle-api"))
        .WithTracing(t => t.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddNpgsql().AddOtlpExporter())
        .WithMetrics(m => m.AddAspNetCoreInstrumentation().AddHttpClientInstrumentation().AddOtlpExporter());
}

builder.Services.AddDbContext<AppDbContext>(o => o.UseNpgsql(
    config.GetConnectionString("Default") ?? throw new InvalidOperationException("ConnectionStrings:Default is not configured.")));

// Keys that encrypt auth cookies live in the database so they survive restarts and scale-out.
builder.Services.AddDataProtection().SetApplicationName("manageBagle").PersistKeysToDbContext<AppDbContext>();

builder.Services
    .AddIdentity<AppUser, IdentityRole<Guid>>(o =>
    {
        o.User.RequireUniqueEmail = true;
        // An email address is only trusted once its owner has opened the confirmation link.
        o.SignIn.RequireConfirmedEmail = true;
        o.Password.RequiredLength = 10;
        o.Password.RequireNonAlphanumeric = false;
        o.Password.RequireUppercase = false;
        o.Password.RequireLowercase = false;
        o.Password.RequireDigit = false;
        o.Password.RequiredUniqueChars = 5;
        o.Lockout.MaxFailedAccessAttempts = 5;
        o.Lockout.DefaultLockoutTimeSpan = TimeSpan.FromMinutes(10);
    })
    .AddEntityFrameworkStores<AppDbContext>()
    .AddDefaultTokenProviders();

builder.Services.Configure<DataProtectionTokenProviderOptions>(o => o.TokenLifespan = TimeSpan.FromHours(2));
// How soon a password change, reset or removed sign-in method ends the account's other sessions.
// Identity's default is 30 minutes; each check costs one small query per signed-in request.
builder.Services.Configure<SecurityStampValidatorOptions>(o =>
    o.ValidationInterval = TimeSpan.FromSeconds(config.GetValue("Auth:SessionRevalidateSeconds", 60)));

var secureCookies = builder.Environment.IsDevelopment() ? CookieSecurePolicy.SameAsRequest : CookieSecurePolicy.Always;

builder.Services.ConfigureApplicationCookie(o =>
{
    o.Cookie.Name = "mb.session";
    o.Cookie.HttpOnly = true;
    o.Cookie.SameSite = SameSiteMode.Lax;
    o.Cookie.SecurePolicy = secureCookies;
    // Idle limit: 14 days without a visit. Absolute limit: 30 days however active, then sign in again.
    o.ExpireTimeSpan = TimeSpan.FromDays(config.GetValue("Auth:IdleSessionDays", 14));
    o.SlidingExpiration = true;
    var absoluteLimit = TimeSpan.FromDays(config.GetValue("Auth:AbsoluteSessionDays", 30));
    o.Events.OnSigningIn = ctx =>
    {
        // Sliding renewals re-issue the cookie; the first sign-in time must survive them.
        ctx.Properties.Items.TryAdd(SessionStartedKey, DateTimeOffset.UtcNow.ToString("O"));
        return Task.CompletedTask;
    };
    o.Events.OnValidatePrincipal = async ctx =>
    {
        if (ctx.Properties.Items.TryGetValue(SessionStartedKey, out var started) &&
            DateTimeOffset.TryParse(started, out var startedAt) && DateTimeOffset.UtcNow - startedAt > absoluteLimit)
        {
            ctx.RejectPrincipal();
            await ctx.HttpContext.SignOutAsync(IdentityConstants.ApplicationScheme);
            return;
        }
        // Identity's own check: a changed password or removed sign-in method ends other sessions.
        await SecurityStampValidator.ValidatePrincipalAsync(ctx);
    };
    // This is an API for a single-page app: answer with status codes, never HTML redirects.
    o.Events.OnRedirectToLogin = ctx => { ctx.Response.StatusCode = StatusCodes.Status401Unauthorized; return Task.CompletedTask; };
    o.Events.OnRedirectToAccessDenied = ctx => { ctx.Response.StatusCode = StatusCodes.Status403Forbidden; return Task.CompletedTask; };
});
foreach (var scheme in new[] { IdentityConstants.ExternalScheme, IdentityConstants.TwoFactorUserIdScheme, IdentityConstants.TwoFactorRememberMeScheme })
{
    builder.Services.Configure<Microsoft.AspNetCore.Authentication.Cookies.CookieAuthenticationOptions>(scheme, o =>
    {
        o.Cookie.HttpOnly = true;
        o.Cookie.SecurePolicy = secureCookies;
    });
}

// External sign-in providers switch on only when their credentials are configured.
var external = builder.Services.AddAuthentication();
var googleId = config["Authentication:Google:ClientId"];
var googleSecret = config["Authentication:Google:ClientSecret"];
if (!string.IsNullOrWhiteSpace(googleId) && !string.IsNullOrWhiteSpace(googleSecret))
{
    external.AddGoogle(o =>
    {
        o.ClientId = googleId;
        o.ClientSecret = googleSecret;
        o.SignInScheme = IdentityConstants.ExternalScheme;
        o.CallbackPath = "/api/auth/external/google/callback";
        o.ClaimActions.MapJsonKey("email_verified", "email_verified", "boolean");
    });
}
var microsoftId = config["Authentication:Microsoft:ClientId"];
var microsoftSecret = config["Authentication:Microsoft:ClientSecret"];
if (!string.IsNullOrWhiteSpace(microsoftId) && !string.IsNullOrWhiteSpace(microsoftSecret))
{
    external.AddMicrosoftAccount(o =>
    {
        o.ClientId = microsoftId;
        o.ClientSecret = microsoftSecret;
        o.SignInScheme = IdentityConstants.ExternalScheme;
        o.CallbackPath = "/api/auth/external/microsoft/callback";
    });
}

builder.Services.AddAuthorization();
builder.Services.Configure<SmtpOptions>(config.GetSection("Smtp"));
builder.Services.AddSingleton<IAppEmailSender, AppEmailSender>();
builder.Services.AddHttpContextAccessor();
builder.Services.AddScoped<AccountLinks>();
builder.Services.AddScoped<ManageBagle.Api.Application.Planning.PlanDay>();
builder.Services.AddScoped<ManageBagle.Api.Application.Timing.FocusTimer>();

builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddApiErrorHandling();
builder.Services.AddValidation();
builder.Services.AddAppHealthChecks();
builder.Services.AddCsrfProtection(secureCookies: !builder.Environment.IsDevelopment());
if (TestClock.Enabled(config)) builder.Services.AddTestClock(builder.Environment);
else builder.Services.AddSingleton(TimeProvider.System);
builder.Services.AddOpenApi();

builder.Services.AddRateLimiter(o =>
{
    o.RejectionStatusCode = StatusCodes.Status429TooManyRequests;
    o.OnRejected = async (ctx, ct) =>
    {
        ctx.HttpContext.Response.Headers.RetryAfter = "60";
        await HttpExtensions.Problem(StatusCodes.Status429TooManyRequests, ErrorCodes.RateLimited, "Too many attempts. Wait a minute and try again.").ExecuteAsync(ctx.HttpContext);
    };
    var authLimit = config.GetValue("RateLimits:AuthPerMinute", 20);
    o.AddPolicy("auth", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = authLimit, Window = TimeSpan.FromMinutes(1) }));
    o.AddPolicy("client-errors", ctx => RateLimitPartition.GetFixedWindowLimiter(
        ctx.Connection.RemoteIpAddress?.ToString() ?? "unknown",
        _ => new FixedWindowRateLimiterOptions { PermitLimit = 20, Window = TimeSpan.FromMinutes(1) }));
});

builder.Services.Configure<ForwardedHeadersOptions>(o => SecurityMiddleware.ConfigureForwardedHeaders(o, config));

var app = builder.Build();

// Release step: `dotnet ManageBagle.Api.dll --migrate` applies reviewed migrations, then exits.
if (args.Contains("--migrate"))
{
    using var scope = app.Services.CreateScope();
    var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
    var pending = (await db.Database.GetPendingMigrationsAsync()).ToList();
    await db.Database.MigrateAsync();
    app.Logger.LogInformation("Applied {Count} migration(s): {Migrations}", pending.Count, string.Join(", ", pending));
    return 0;
}

app.UseForwardedHeaders();
app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
}
app.UseSecurityHeaders();

app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = ctx =>
    {
        // Vite fingerprints everything under /assets, so those files can be cached forever.
        var immutable = ctx.Context.Request.Path.StartsWithSegments("/assets");
        ctx.Context.Response.Headers.CacheControl = immutable ? "public, max-age=31536000, immutable" : "no-cache";
    },
});

app.UseRateLimiter();
app.UseAuthentication();
app.UseRequestLogging();
app.UseCsrfProtection();
app.UseAuthorization();

app.MapAppHealthChecks();
// The API description is for developers and UAT; it is not published in production.
if (!app.Environment.IsProduction())
{
    app.MapOpenApi("/api/openapi.json");
}
app.MapAuthEndpoints();
app.MapAreaEndpoints();
app.MapBlockEndpoints();
app.MapBacklogEndpoints();
app.MapDayEndpoints();
app.MapPlanEndpoints();
app.MapTimerEndpoints();
app.MapSummaryEndpoints();
app.MapClientErrorEndpoints();
if (TestClock.Enabled(config)) app.MapTestClock();

app.MapFallback("/api/{**path}", () => HttpExtensions.Problem(StatusCodes.Status404NotFound, ErrorCodes.NotFound, "There is nothing at this address."));
app.MapFallbackToFile("index.html");

// Convenient on a developer machine. Everywhere else migrations are an explicit release step
// (--migrate), and /health/ready stays unhealthy until the schema is current.
if (config.GetValue("Database:MigrateOnStartup", false))
{
    using var scope = app.Services.CreateScope();
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.MigrateAsync();
}

await app.RunAsync();
return 0;

public partial class Program;
