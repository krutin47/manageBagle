using System.Diagnostics;
using System.Security.Claims;

namespace ManageBagle.Api.Infrastructure;

/// <summary>
/// One structured line per API request: route template (never the raw URL with its ids and dates in
/// free text), status, duration, trace id and the account id. No bodies, no query strings, no titles.
/// </summary>
public static class RequestLogging
{
    public const string TraceHeader = "X-Trace-Id";

    public static string RouteOf(HttpContext http) =>
        (http.GetEndpoint() as RouteEndpoint)?.RoutePattern.RawText ?? "(unmatched)";

    public static IApplicationBuilder UseRequestLogging(this IApplicationBuilder app) => app.Use(async (http, next) =>
    {
        if (!http.Request.Path.StartsWithSegments("/api"))
        {
            await next();
            return;
        }

        var log = http.RequestServices.GetRequiredService<ILoggerFactory>().CreateLogger("ManageBagle.Http");
        var traceId = Tracing.TraceId(http);
        http.Response.Headers[TraceHeader] = traceId;
        var started = Stopwatch.GetTimestamp();
        try
        {
            await next();
        }
        finally
        {
            var elapsedMs = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            var status = http.Response.StatusCode;
            var level = status >= 500 ? LogLevel.Error : status == 429 ? LogLevel.Warning : LogLevel.Information;
            log.Log(level, "{Method} {Route} responded {Status} in {ElapsedMs:0.0} ms (trace {TraceId}, user {UserId})",
                http.Request.Method, RouteOf(http), status, elapsedMs, traceId,
                http.User.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous");
        }
    });
}
