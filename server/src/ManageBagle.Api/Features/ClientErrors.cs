using System.ComponentModel.DataAnnotations;
using System.Security.Claims;

namespace ManageBagle.Api.Features;

/// <param name="Kind">"render" (caught by an error boundary), "script" (uncaught error) or "promise" (unhandled rejection).</param>
/// <param name="Reference">The short id shown to the person, so their report can be matched to this log line.</param>
public record ClientErrorReport(
    [Required, RegularExpression("^(render|script|promise)$")] string Kind,
    [Required, StringLength(300)] string Message,
    [StringLength(200)] string? Route,
    [StringLength(16)] string? Reference,
    [StringLength(60)] string? Release);

/// <summary>
/// Browser errors land in the same logs (and telemetry backend) as server errors. Messages are
/// truncated and only the route template-like path is kept: no query strings, no form contents.
/// Anonymous reports are allowed (a sign-in page can crash too) but rate limited per address.
/// </summary>
public static class ClientErrors
{
    public static void MapClientErrorEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapPost("/api/client-errors", (ClientErrorReport report, ClaimsPrincipal user, ILoggerFactory logs) =>
        {
            var route = report.Route?.Split('?', '#')[0];
            logs.CreateLogger("ManageBagle.Client").LogWarning(
                "Client {Kind} error at {Route} (ref {Reference}, release {Release}, user {UserId}): {Message}",
                report.Kind, route ?? "", report.Reference ?? "", report.Release ?? "",
                user.FindFirstValue(ClaimTypes.NameIdentifier) ?? "anonymous", report.Message);
            Infrastructure.ErrorReporting.ReportClientError(report.Kind, report.Message, route, report.Reference, report.Release, user.FindFirstValue(ClaimTypes.NameIdentifier));
            return Results.Accepted();
        }).RequireRateLimiting("client-errors").WithTags("Diagnostics").Produces(StatusCodes.Status202Accepted).ProducesValidationProblem();
    }
}
