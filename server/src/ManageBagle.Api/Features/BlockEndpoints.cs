using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

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
    bool IsOutside = false);

/// <summary>Quick update from the timeline: status and/or logged minutes only.</summary>
public record BlockProgressRequest(ItemStatus? Status, [Range(0, 1440)] int? ActualMinutes, bool ClearActual);

public record BlockResponse(
    Guid Id, DateOnly Date, TimeOnly Start, TimeOnly End, string Title, Guid? FocusAreaId,
    Priority Priority, WorkMode WorkMode, ItemStatus Status, int? ActualMinutes, int PlannedMinutes,
    int? VarianceMinutes, string Notes, bool IsOutside, Guid? BacklogTaskId)
{
    public static BlockResponse From(TimeBlock b) => new(
        b.Id, b.Date, b.Start, b.End, b.Title, b.FocusAreaId, b.Priority, b.WorkMode, b.Status,
        b.ActualMinutes, b.PlannedMinutes, b.ActualMinutes - b.PlannedMinutes, b.Notes, b.IsOutside, b.BacklogTaskId);
}

public static class BlockEndpoints
{
    public const int MaxRangeDays = 62;

    public static void MapBlockEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/blocks").RequireAuthorization().WithTags("Time blocks");

        g.MapGet("", async (DateOnly from, DateOnly to, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (to < from || to.DayNumber - from.DayNumber > MaxRangeDays)
            {
                return HttpExtensions.Invalid("to", $"Ask for a range of at most {MaxRangeDays} days.");
            }
            var blocks = await db.TimeBlocks.AsNoTracking()
                .Where(b => b.UserId == user.UserId() && b.Date >= from && b.Date <= to)
                .OrderBy(b => b.Date).ThenBy(b => b.Start)
                .ToListAsync();
            return Results.Ok(blocks.Select(BlockResponse.From));
        });

        g.MapPost("", async (BlockRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            if (await Validate(req, uid, db) is { } problem) return problem;
            var block = new TimeBlock { UserId = uid };
            Apply(block, req);
            db.TimeBlocks.Add(block);
            await db.SaveChangesAsync();
            return Results.Created($"/api/blocks/{block.Id}", BlockResponse.From(block));
        });

        g.MapPut("/{id:guid}", async (Guid id, BlockRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == id && b.UserId == uid);
            if (block is null) return Results.NotFound();
            if (await Validate(req, uid, db) is { } problem) return problem;
            Apply(block, req);
            await SyncLinkedTask(db, block);
            await db.SaveChangesAsync();
            return Results.Ok(BlockResponse.From(block));
        });

        g.MapPatch("/{id:guid}/progress", async (Guid id, BlockProgressRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == id && b.UserId == user.UserId());
            if (block is null) return Results.NotFound();
            if (req.Status is { } status) block.Status = status;
            if (req.ClearActual) block.ActualMinutes = null;
            else if (req.ActualMinutes is { } actual) block.ActualMinutes = actual;
            await SyncLinkedTask(db, block);
            await db.SaveChangesAsync();
            return Results.Ok(BlockResponse.From(block));
        });

        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == id && b.UserId == user.UserId());
            if (block is null) return Results.NotFound();
            db.TimeBlocks.Remove(block);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });
    }

    private static async Task<IResult?> Validate(BlockRequest req, Guid userId, AppDbContext db)
    {
        if (req.Start.Minute % 5 != 0 || req.Start.Second != 0) return HttpExtensions.Invalid("start", "Use 5-minute steps for the start time.");
        if (req.End.Minute % 5 != 0 || req.End.Second != 0) return HttpExtensions.Invalid("end", "Use 5-minute steps for the end time.");
        if (req.Start == req.End) return HttpExtensions.Invalid("end", "The end time must differ from the start time.");
        if (!await db.OwnsAreaAsync(userId, req.FocusAreaId)) return HttpExtensions.Invalid("focusAreaId", "That focus area does not exist.");
        return null;
    }

    private static void Apply(TimeBlock block, BlockRequest req)
    {
        block.Date = req.Date;
        block.Start = req.Start;
        block.End = req.End;
        block.Title = req.Title.Trim();
        block.FocusAreaId = req.FocusAreaId;
        block.Priority = req.Priority;
        block.WorkMode = req.WorkMode;
        block.Status = req.Status;
        block.ActualMinutes = req.ActualMinutes;
        block.Notes = req.Notes?.Trim() ?? "";
        block.IsOutside = req.IsOutside;
    }

    /// <summary>
    /// A block booked from a task shares its fate: finishing the block finishes the task and, if the
    /// task is one of that day's top three, ticks the outcome too. One tick, not three.
    /// </summary>
    private static async Task SyncLinkedTask(AppDbContext db, TimeBlock block)
    {
        if (block.BacklogTaskId is null || block.Status != ItemStatus.Done) return;
        var task = await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == block.BacklogTaskId && t.UserId == block.UserId);
        if (task is not null) task.Status = ItemStatus.Done;
        var outcomes = await db.DailyOutcomes
            .Where(o => o.UserId == block.UserId && o.Date == block.Date && o.BacklogTaskId == block.BacklogTaskId).ToListAsync();
        foreach (var outcome in outcomes) outcome.Status = ItemStatus.Done;
    }
}
