using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Application.Ai;
using ManageBagle.Api.Infrastructure;

namespace ManageBagle.Api.Features;

public record SuggestTasksRequest([Required, StringLength(SuggestTasks.MaxLength, MinimumLength = 1)] string Text);
public record SuggestTasksResponse(IReadOnlyList<TaskSuggestion> Tasks, int RemainingToday);

/// <summary>The AI brain dump (P3-AI1, ADR-020): suggestions only; nothing is saved here.</summary>
public static class AiEndpoints
{
    public static void MapAiEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/ai").RequireAuthorization().WithTags("AI");

        g.MapGet("/status", async (ClaimsPrincipal user, SuggestTasks suggest, CancellationToken ct) => Results.Ok(await suggest.StatusAsync(user.UserId(), ct)))
            .Produces<AiStatus>();

        g.MapPost("/suggest-tasks", async (SuggestTasksRequest req, ClaimsPrincipal user, SuggestTasks suggest, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var result = await suggest.HandleAsync(uid, req.Text, ct);
            if (!result.Succeeded) return result.Failure!.ToHttp();
            return Results.Ok(new SuggestTasksResponse(result.Value!, (await suggest.StatusAsync(uid, ct)).RemainingToday));
        })
        .RequireRateLimiting("calendar-fetch") // a few a minute per account, on top of the daily limit
        .Produces<SuggestTasksResponse>().ProducesValidationProblem()
        .ProducesProblem(StatusCodes.Status429TooManyRequests).ProducesProblem(StatusCodes.Status503ServiceUnavailable);
    }
}
