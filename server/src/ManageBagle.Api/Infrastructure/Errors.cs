using System.Diagnostics;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace ManageBagle.Api.Infrastructure;

/// <summary>Stable machine-readable codes the client switches on. Changing one is a breaking API change.</summary>
public static class ErrorCodes
{
    public const string Unexpected = "unexpected";
    public const string StaleVersion = "stale_version";
    public const string Conflict = "conflict";
    public const string CsrfInvalid = "csrf_invalid";
    public const string OriginRejected = "origin_rejected";
    public const string ClientHeaderMissing = "client_header_missing";
    public const string NotFound = "not_found";
    public const string Unauthorized = "unauthorized";
    public const string RateLimited = "rate_limited";
    public const string NonexistentLocalTime = "nonexistent_local_time";
    public const string IdempotencyKeyReused = "idempotency_key_reused";
}

public static class Tracing
{
    /// <summary>The W3C trace id of the current request: the same value appears in logs, traces and error responses.</summary>
    public static string TraceId(HttpContext http) => Activity.Current?.TraceId.ToString() ?? http.TraceIdentifier;
}

/// <summary>
/// The single place where unexpected failures become HTTP responses. Expected outcomes (validation,
/// not found, conflicts the endpoint anticipates) are returned by the endpoints as problem details
/// and never reach this handler.
/// </summary>
public sealed class ApiExceptionHandler(IProblemDetailsService problems, ILogger<ApiExceptionHandler> log) : IExceptionHandler
{
    public async ValueTask<bool> TryHandleAsync(HttpContext http, Exception exception, CancellationToken ct)
    {
        // The browser went away. Nobody is listening, and it is not a server fault worth an alert.
        if (exception is OperationCanceledException && http.RequestAborted.IsCancellationRequested)
        {
            http.Response.StatusCode = 499;
            return true;
        }

        var (status, code, detail) = exception switch
        {
            DbUpdateConcurrencyException => (StatusCodes.Status409Conflict, ErrorCodes.StaleVersion,
                "This was changed somewhere else since you loaded it. Reload to see the latest version."),
            DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } } =>
                (StatusCodes.Status409Conflict, ErrorCodes.Conflict, "That conflicts with a change made at the same moment. Reload and try again."),
            AntiforgeryValidationException => (StatusCodes.Status400BadRequest, ErrorCodes.CsrfInvalid,
                "Your session token is out of date. Reload the page and try again."),
            BadHttpRequestException bad => (bad.StatusCode, "bad_request", "The request could not be read."),
            _ => (StatusCodes.Status500InternalServerError, ErrorCodes.Unexpected,
                "Something went wrong on our side. If it keeps happening, quote the reference below."),
        };

        if (status >= 500)
        {
            // Logged once, here. Message templates carry no request bodies or user-written content.
            log.LogError(exception, "Unhandled failure in {Method} {Route}", http.Request.Method, RequestLogging.RouteOf(http));
        }

        http.Response.StatusCode = status;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = http,
            Exception = exception,
            ProblemDetails = new ProblemDetails { Status = status, Detail = detail, Extensions = { ["code"] = code } },
        });
    }
}

public static class ErrorSetup
{
    public static IServiceCollection AddApiErrorHandling(this IServiceCollection services)
    {
        services.AddExceptionHandler<ApiExceptionHandler>();
        services.AddProblemDetails(o => o.CustomizeProblemDetails = ctx =>
        {
            // Every error, expected or not, carries the trace id so a user's report can be matched to logs.
            ctx.ProblemDetails.Extensions["traceId"] = Tracing.TraceId(ctx.HttpContext);
            if (!ctx.ProblemDetails.Extensions.ContainsKey("code"))
            {
                ctx.ProblemDetails.Extensions["code"] = ctx.ProblemDetails.Status switch
                {
                    StatusCodes.Status400BadRequest => "validation_failed",
                    StatusCodes.Status401Unauthorized => ErrorCodes.Unauthorized,
                    StatusCodes.Status403Forbidden => "forbidden",
                    StatusCodes.Status404NotFound => ErrorCodes.NotFound,
                    StatusCodes.Status409Conflict => ErrorCodes.Conflict,
                    StatusCodes.Status429TooManyRequests => ErrorCodes.RateLimited,
                    _ => ErrorCodes.Unexpected,
                };
            }
        });
        return services;
    }
}
