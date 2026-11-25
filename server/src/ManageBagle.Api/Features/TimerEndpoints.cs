using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Application.Timing;
using ManageBagle.Api.Domain;
using ManageBagle.Api.Infrastructure;

namespace ManageBagle.Api.Features;

public record TimerStartRequest(bool PauseRunning = false);

public record TimerExtendRequest([Range(5, 60)] int Minutes);

public record TimerStopRequest(StopOutcome Outcome, [StringLength(500)] string? Note);

/// <param name="ServerNow">The server's clock; elapsed time is computed against it, not the device's.</param>
/// <param name="PausedBlockId">When starting this block paused another, which one.</param>
public record TimerResponse(BlockResponse Block, DateTimeOffset ServerNow, Guid? PausedBlockId);

public static class TimerEndpoints
{
    public static void MapTimerEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api").RequireAuthorization().WithTags("Focus timer");
        static IResult Ok(FocusTimer.Snapshot s) => Results.Ok(new TimerResponse(BlockResponse.From(s.Block), s.ServerNow, s.PausedBlockId));

        g.MapGet("/timer", async (ClaimsPrincipal user, FocusTimer timer, CancellationToken ct) =>
            await timer.RunningAsync(user.UserId(), ct) is { } running ? Ok(running) : Results.NoContent())
            .Produces<TimerResponse>().Produces(StatusCodes.Status204NoContent);

        g.MapPost("/blocks/{id:guid}/timer/start", async (Guid id, TimerStartRequest? req, ClaimsPrincipal user, FocusTimer timer, CancellationToken ct) =>
            (await timer.StartAsync(user.UserId(), id, req?.PauseRunning ?? false, ct)).ToHttp(Ok))
            .Produces<TimerResponse>().ProducesProblem(StatusCodes.Status409Conflict);

        g.MapPost("/blocks/{id:guid}/timer/pause", async (Guid id, ClaimsPrincipal user, FocusTimer timer, CancellationToken ct) =>
            (await timer.PauseAsync(user.UserId(), id, ct)).ToHttp(Ok)).Produces<TimerResponse>();

        g.MapPost("/blocks/{id:guid}/timer/extend", async (Guid id, TimerExtendRequest req, ClaimsPrincipal user, FocusTimer timer, CancellationToken ct) =>
            (await timer.ExtendAsync(user.UserId(), id, req.Minutes, ct)).ToHttp(Ok)).Produces<TimerResponse>().ProducesValidationProblem();

        g.MapPost("/blocks/{id:guid}/timer/stop", async (Guid id, TimerStopRequest req, ClaimsPrincipal user, FocusTimer timer, CancellationToken ct) =>
            (await timer.StopAsync(user.UserId(), id, req.Outcome, req.Note, ct)).ToHttp(Ok)).Produces<TimerResponse>().ProducesValidationProblem();
    }
}
