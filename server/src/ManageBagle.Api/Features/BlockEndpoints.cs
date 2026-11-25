using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Domain;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

/// <param name="Version">Required when updating: the version the client last saw. A mismatch is a 409.</param>
public record BlockRequest(
    DateOnly Date,
    TimeOnly Start,
    TimeOnly End,
    [Required, StringLength(200, MinimumLength = 1)] string Title,
    Guid? FocusAreaId,
    Priority Priority,
    WorkMode WorkMode,
    ItemStatus Status,
    [Range(0, 1440)] int? ActualMinutes,
    [StringLength(2000)] string? Notes,
    bool IsOutside = false,
    int? Version = null,
    [Range(0, 60)] int BreakBeforeMinutes = 0,
    [Range(0, 60)] int BreakAfterMinutes = 0);

/// <summary>Quick update from the timeline: status and/or logged minutes only.</summary>
public record BlockProgressRequest(ItemStatus? Status, [Range(0, 1440)] int? ActualMinutes, bool ClearActual, int? Version = null);

public record BlockResponse(
    Guid Id, DateOnly Date, TimeOnly Start, TimeOnly End, string Title, Guid? FocusAreaId,
    Priority Priority, WorkMode WorkMode, ItemStatus Status, int? ActualMinutes, int PlannedMinutes,
    int? VarianceMinutes, string Notes, bool IsOutside, Guid? BacklogTaskId, string? TimeZone, int Version,
    DateTimeOffset? TimerStartedAt, int TrackedSeconds, int ExtendedMinutes, string StopNote, int BreakBeforeMinutes, int BreakAfterMinutes)
{
    public static BlockResponse From(TimeBlock b) => new(
        b.Id, b.Date, b.Start, b.End, b.Title, b.FocusAreaId, b.Priority, b.WorkMode, b.Status,
        b.ActualMinutes, b.PlannedMinutes, b.ActualMinutes - b.PlannedMinutes, b.Notes, b.IsOutside, b.BacklogTaskId, b.TimeZoneId, b.Version,
        b.TimerStartedAt, b.TrackedSeconds, b.ExtendedMinutes, b.StopNote, b.BreakBeforeMinutes, b.BreakAfterMinutes);
}

public static class BlockEndpoints
{
    public const int MaxRangeDays = 62;

    public static void MapBlockEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/blocks").RequireAuthorization().WithTags("Time blocks");

        g.MapGet("", async (DateOnly from, DateOnly to, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (to < from || to.DayNumber - from.DayNumber > MaxRangeDays)
            {
                return HttpExtensions.Invalid("to", $"Ask for a range of at most {MaxRangeDays} days.");
            }
            var uid = user.UserId();
            var blocks = await db.TimeBlocks.AsNoTracking()
                .Where(b => b.UserId == uid && b.Date >= from && b.Date <= to)
                .OrderBy(b => b.Date).ThenBy(b => b.Start)
                .ToListAsync(ct);
            return Results.Ok(blocks.Select(BlockResponse.From));
        }).Produces<IEnumerable<BlockResponse>>();

        g.MapPost("", async (BlockRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            if (await Validate(req, uid, db, ct) is { } problem) return problem;
            var block = new TimeBlock { UserId = uid };
            if (block.Schedule(req.Date, req.Start, req.End, await db.TimeZoneOf(uid, ct)) is { } gap) return NonexistentTime(gap);
            Apply(block, req);
            db.TimeBlocks.Add(block);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/blocks/{block.Id}", BlockResponse.From(block));
        }).Produces<BlockResponse>(StatusCodes.Status201Created).ProducesValidationProblem();

        g.MapPut("/{id:guid}", async (Guid id, BlockRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == id && b.UserId == uid, ct);
            if (block is null) return Results.NotFound();
            if (Versioning.Check(db, block, req.Version) is { } stale) return stale;
            if (await Validate(req, uid, db, ct) is { } problem) return problem;
            // A block stays anchored to the zone it was planned in; rows from before zones adopt the account's.
            if (block.Schedule(req.Date, req.Start, req.End, block.TimeZoneId ?? await db.TimeZoneOf(uid, ct)) is { } gap) return NonexistentTime(gap);
            Apply(block, req);
            await SyncLinkedTask(db, block, ct);
            await db.SaveChangesAsync(ct);
            return Results.Ok(BlockResponse.From(block));
        }).Produces<BlockResponse>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);

        g.MapPatch("/{id:guid}/progress", async (Guid id, BlockProgressRequest req, ClaimsPrincipal user, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == id && b.UserId == uid, ct);
            if (block is null) return Results.NotFound();
            if (Versioning.Check(db, block, req.Version) is { } stale) return stale;
            // Closing a block by hand while its timer runs banks the time first.
            if (req.Status is ItemStatus.Done or ItemStatus.Skipped or ItemStatus.Planned) block.PauseTimer(clock.GetUtcNow());
            if (req.Status is { } status) block.Status = status;
            if (req.ClearActual) block.ActualMinutes = null;
            else if (req.ActualMinutes is { } actual) block.ActualMinutes = actual;
            await SyncLinkedTask(db, block, ct);
            await db.SaveChangesAsync(ct);
            return Results.Ok(BlockResponse.From(block));
        }).Produces<BlockResponse>().ProducesProblem(StatusCodes.Status409Conflict);

        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == id && b.UserId == uid, ct);
            if (block is null) return Results.NotFound();
            db.TimeBlocks.Remove(block);
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });
    }

    private static async Task<IResult?> Validate(BlockRequest req, Guid userId, AppDbContext db, CancellationToken ct)
    {
        if (req.Start.Minute % 5 != 0 || req.Start.Second != 0) return HttpExtensions.Invalid("start", "Use 5-minute steps for the start time.");
        if (req.End.Minute % 5 != 0 || req.End.Second != 0) return HttpExtensions.Invalid("end", "Use 5-minute steps for the end time.");
        if (req.Start == req.End) return HttpExtensions.Invalid("end", "The end time must differ from the start time.");
        if (!await db.OwnsAreaAsync(userId, req.FocusAreaId, ct)) return HttpExtensions.Invalid("focusAreaId", "That focus area does not exist.");
        return null;
    }

    internal static IResult NonexistentTime(CivilTime.Span.Nonexistent gap) => Application.Failure.NonexistentTime(gap).ToHttp();

    private static void Apply(TimeBlock block, BlockRequest req)
    {
        block.Title = req.Title.Trim();
        block.FocusAreaId = req.FocusAreaId;
        block.Priority = req.Priority;
        block.WorkMode = req.WorkMode;
        block.Status = req.Status;
        block.ActualMinutes = req.ActualMinutes;
        block.Notes = req.Notes?.Trim() ?? "";
        block.IsOutside = req.IsOutside;
        block.BreakBeforeMinutes = req.BreakBeforeMinutes;
        block.BreakAfterMinutes = req.BreakAfterMinutes;
    }

    /// <summary>
    /// A block booked from a task is one session of that task. The task's board column follows
    /// (P2-G1, <see cref="TaskCompletion.AfterSessionChanged"/>), and a top-three outcome for that day is
    /// ticked only when all of that day's sessions are finished.
    /// </summary>
    internal static async Task SyncLinkedTask(AppDbContext db, TimeBlock block, CancellationToken ct)
    {
        if (block.BacklogTaskId is null) return;
        var others = await db.TimeBlocks.AsNoTracking()
            .Where(b => b.UserId == block.UserId && b.BacklogTaskId == block.BacklogTaskId && b.Id != block.Id)
            .Select(b => new { b.Date, b.Status })
            .ToListAsync(ct);

        var task = await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == block.BacklogTaskId && t.UserId == block.UserId, ct);
        if (task is not null)
        {
            var next = TaskCompletion.AfterSessionChanged(task.Status, block.Status, others.Select(o => o.Status), (block.ActualMinutes ?? 0) > 0 || block.TrackedSeconds >= 30);
            task.Status = next.Status;
            if (next.Unschedule) task.ScheduledDate = null;
        }

        if (block.Status != ItemStatus.Done || others.Where(o => o.Date == block.Date).Any(o => TaskCompletion.IsOpen(o.Status))) return;
        var outcomes = await db.DailyOutcomes
            .Where(o => o.UserId == block.UserId && o.Date == block.Date && o.BacklogTaskId == block.BacklogTaskId).ToListAsync(ct);
        foreach (var outcome in outcomes) outcome.Status = ItemStatus.Done;
    }
}

public static class Versioning
{
    /// <summary>
    /// Optimistic concurrency: the caller states which version it edited. If that is not the current
    /// one, someone else (another tab, another device) saved first and this write is refused with 409.
    /// The original value is also pinned on the entity, so two writers racing past this check are still
    /// caught by the database UPDATE.
    /// </summary>
    public static IResult? Check<T>(AppDbContext db, T entity, int? expected) where T : class, IVersioned
    {
        if (expected is null) return HttpExtensions.Invalid("version", "Send the version you last loaded.");
        if (expected != entity.Version)
        {
            return HttpExtensions.Problem(StatusCodes.Status409Conflict, ErrorCodes.StaleVersion,
                "This was changed somewhere else since you loaded it. Reload to see the latest version.");
        }
        db.Entry(entity).Property(e => e.Version).OriginalValue = expected.Value;
        // Moved on here rather than left to change tracking, so that even a save that alters nothing
        // else still claims the version: of several writers holding the same version, exactly one wins.
        entity.Version = expected.Value + 1;
        return null;
    }

    public static async Task<string?> TimeZoneOf(this AppDbContext db, Guid userId, CancellationToken ct) =>
        await db.Users.Where(u => u.Id == userId).Select(u => u.TimeZoneId).FirstOrDefaultAsync(ct);
}
