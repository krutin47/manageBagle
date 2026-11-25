using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

public record TaskRequest(
    [Required, StringLength(200, MinimumLength = 1)] string Title,
    Guid? FocusAreaId,
    [Range(5, 1440)] int? EstimatedMinutes,
    Priority Priority,
    DateOnly? DueDate,
    ItemStatus Status,
    [StringLength(200)] string? NextStep,
    WorkMode WorkMode = WorkMode.DeepFocus,
    bool IsOutside = false,
    Priority Impact = Priority.Medium,
    int? Version = null,
    [Range(0, 60)] int? BreakMinutes = null);

public record CaptureRequest([Required, MinLength(1), MaxLength(60)] Application.Planning.CaptureItem[] Items);

public record ScheduledTaskResponse(TaskResponse Task, BlockResponse Block);

public record ScheduleRequest(DateOnly Date, TimeOnly Start, TimeOnly End, WorkMode WorkMode);

public record TaskResponse(
    Guid Id, string Title, Guid? FocusAreaId, int? EstimatedMinutes, Priority Priority, DateOnly? DueDate,
    ItemStatus Status, string NextStep, WorkMode WorkMode, bool IsOutside, Priority Impact, DateOnly? ScheduledDate, DateTimeOffset CreatedAt, int Version, int? BreakMinutes)
{
    public static TaskResponse From(BacklogTask t) => new(
        t.Id, t.Title, t.FocusAreaId, t.EstimatedMinutes, t.Priority, t.DueDate, t.Status, t.NextStep, t.WorkMode, t.IsOutside, t.Impact, t.ScheduledDate, t.CreatedAt, t.Version, t.BreakMinutes);
}

public static class BacklogEndpoints
{
    /// <summary>How long finished and dropped tasks stay in the default backlog response.</summary>
    public const int ClosedDays = 30;

    public static void MapBacklogEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/backlog").RequireAuthorization().WithTags("Backlog");

        // Open tasks, plus finished and dropped ones closed in the last ClosedDays days; history=all
        // returns everything. Keeps the response bounded as the years go by (handbook §7.1).
        g.MapGet("", async (string? history, ClaimsPrincipal user, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var query = db.BacklogTasks.AsNoTracking().Where(t => t.UserId == uid);
            if (history != "all")
            {
                var since = clock.GetUtcNow().AddDays(-ClosedDays);
                query = query.Where(t => t.ClosedAt == null || t.ClosedAt >= since);
            }
            var tasks = await query.OrderBy(t => t.CreatedAt).ToListAsync(ct);
            return tasks.Select(TaskResponse.From);
        });

        // The brain dump: many tasks captured at once, all or nothing (P2-E1).
        g.MapPost("/capture", async (CaptureRequest req, ClaimsPrincipal user, Application.Planning.CaptureTasks capture, CancellationToken ct) =>
            (await capture.HandleAsync(user.UserId(), req.Items, ct)).ToHttp(tasks => Results.Ok(tasks.Select(TaskResponse.From))))
            .Produces<IEnumerable<TaskResponse>>().ProducesValidationProblem();

        g.MapPost("", async (TaskRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            if (!await db.OwnsAreaAsync(uid, req.FocusAreaId)) return HttpExtensions.Invalid("focusAreaId", "That focus area does not exist.");
            var task = new BacklogTask { UserId = uid };
            Apply(task, req);
            db.BacklogTasks.Add(task);
            await db.SaveChangesAsync();
            return Results.Created($"/api/backlog/{task.Id}", TaskResponse.From(task));
        }).Produces<TaskResponse>(StatusCodes.Status201Created).ProducesValidationProblem();

        g.MapPut("/{id:guid}", async (Guid id, TaskRequest req, ClaimsPrincipal user, AppDbContext db, Application.Tasks.ChangeTaskStatus status, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var task = await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == uid, ct);
            if (task is null) return Results.NotFound();
            if (Versioning.Check(db, task, req.Version) is { } stale) return stale;
            if (!await db.OwnsAreaAsync(uid, req.FocusAreaId)) return HttpExtensions.Invalid("focusAreaId", "That focus area does not exist.");
            var previous = task.Status;
            Apply(task, req);
            await status.FollowAsync(task, previous, ct);
            await db.SaveChangesAsync(ct);
            return Results.Ok(TaskResponse.From(task));
        }).Produces<TaskResponse>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);

        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var task = await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId());
            if (task is null) return Results.NotFound();
            db.BacklogTasks.Remove(task);
            await db.SaveChangesAsync();
            return Results.NoContent();
        }).Produces(StatusCodes.Status204NoContent);

        // "Capture first, schedule second": turn a task into a committed block on the calendar.
        g.MapPost("/{id:guid}/schedule", async (Guid id, ScheduleRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            var task = await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == uid);
            if (task is null) return Results.NotFound();
            if (req.Start.Minute % 5 != 0 || req.End.Minute % 5 != 0) return HttpExtensions.Invalid("start", "Use 5-minute steps.");
            if (req.Start == req.End) return HttpExtensions.Invalid("end", "The end time must differ from the start time.");

            var block = new TimeBlock
            {
                UserId = uid, Title = task.Title,
                FocusAreaId = task.FocusAreaId, Priority = task.Priority, WorkMode = req.WorkMode, IsOutside = task.IsOutside,
                Notes = task.NextStep.Length > 0 ? $"Next step: {task.NextStep}" : "", BacklogTaskId = task.Id,
            };
            if (block.Schedule(req.Date, req.Start, req.End, await db.TimeZoneOf(uid, default)) is { } gap) return BlockEndpoints.NonexistentTime(gap);
            task.ScheduledDate = req.Date;
            task.WorkMode = req.WorkMode;
            db.TimeBlocks.Add(block);
            await db.SaveChangesAsync();
            return Results.Created($"/api/blocks/{block.Id}", new ScheduledTaskResponse(TaskResponse.From(task), BlockResponse.From(block)));
        }).Produces<ScheduledTaskResponse>(StatusCodes.Status201Created).ProducesValidationProblem();
    }

    private static void Apply(BacklogTask task, TaskRequest req)
    {
        task.Title = req.Title.Trim();
        task.FocusAreaId = req.FocusAreaId;
        task.EstimatedMinutes = req.EstimatedMinutes;
        task.Priority = req.Priority;
        task.DueDate = req.DueDate;
        task.Status = req.Status;
        task.NextStep = req.NextStep?.Trim() ?? "";
        task.WorkMode = req.WorkMode;
        task.IsOutside = req.IsOutside;
        task.Impact = req.Impact;
        task.BreakMinutes = req.BreakMinutes;
    }
}
