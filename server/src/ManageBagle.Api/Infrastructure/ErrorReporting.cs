using System.Security.Claims;
using Sentry;
using Sentry.Extensions.Logging;

namespace ManageBagle.Api.Infrastructure;

/// <summary>
/// Error monitoring with Sentry (ADR-018), on only when Sentry:Dsn is set.
///
/// What reaches Sentry is decided here and nowhere else: every log entry at Error level or above
/// (server failures are logged once, with the exception and the route template, by
/// ApiExceptionHandler), and browser errors forwarded by /api/client-errors. The SDK's automatic
/// request capture is not used, so no URL, query string, header, cookie or body is ever attached;
/// the only identity is the account's opaque id.
/// </summary>
public static class ErrorReporting
{
    public static void AddErrorReporting(this WebApplicationBuilder builder)
    {
        var dsn = builder.Configuration["Sentry:Dsn"];
        if (string.IsNullOrWhiteSpace(dsn)) return;
        builder.Logging.AddSentry(o =>
        {
            o.Dsn = dsn;
            o.Environment = builder.Environment.EnvironmentName;
            o.Release = builder.Configuration["App:Release"] ?? typeof(ErrorReporting).Assembly.GetName().Version?.ToString();
            o.SendDefaultPii = false;
            o.TracesSampleRate = 0; // traces go to OpenTelemetry; the free plan's quota is for errors
            o.MinimumEventLevel = LogLevel.Error;
            o.MinimumBreadcrumbLevel = LogLevel.Warning;
            o.AttachStacktrace = false; // exceptions carry their own; a server stack on a browser error is noise
            o.ReportAssembliesMode = ReportAssembliesMode.None; // no list of loaded libraries: not needed to fix errors
        });
    }

    /// <summary>Errors during a request carry the account id (an opaque GUID), so one person's repeats group together.</summary>
    public static IApplicationBuilder UseErrorReportingScope(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        if (!SentrySdk.IsEnabled)
        {
            await next();
            return;
        }
        using (SentrySdk.PushScope())
        {
            if (http.User.FindFirstValue(ClaimTypes.NameIdentifier) is { } id) SentrySdk.ConfigureScope(s => s.User = new SentryUser { Id = id });
            await next();
        }
    });

    /// <summary>A browser error, as the client reported it: kind, message, route (no query), the reference the person saw.</summary>
    public static void ReportClientError(string kind, string message, string? route, string? reference, string? release, string? userId)
    {
        if (!SentrySdk.IsEnabled) return;
        SentrySdk.CaptureMessage($"Browser {kind} error: {message}", scope =>
        {
            scope.SetTag("source", "browser");
            scope.SetTag("route", route ?? "");
            if (!string.IsNullOrEmpty(reference)) scope.SetTag("reference", reference);
            if (!string.IsNullOrEmpty(release)) scope.SetTag("client_release", release);
            if (userId is not null) scope.User = new SentryUser { Id = userId };
        }, SentryLevel.Error);
    }
}
