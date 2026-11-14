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
    Priority Impact = Priority.Medium);

public record ScheduleRequest(DateOnly Date, TimeOnly Start, TimeOnly End, WorkMode WorkMode);

public record TaskResponse(
    Guid Id, string Title, Guid? FocusAreaId, int? EstimatedMinutes, Priority Priority, DateOnly? DueDate,
    ItemStatus Status, string NextStep, WorkMode WorkMode, bool IsOutside, Priority Impact, DateOnly? ScheduledDate, DateTimeOffset CreatedAt)
{
    public static TaskResponse From(BacklogTask t) => new(
        t.Id, t.Title, t.FocusAreaId, t.EstimatedMinutes, t.Priority, t.DueDate, t.Status, t.NextStep, t.WorkMode, t.IsOutside, t.Impact, t.ScheduledDate, t.CreatedAt);
}

public static class BacklogEndpoints
{
    public static void MapBacklogEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/backlog").RequireAuthorization().WithTags("Backlog");

        g.MapGet("", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var tasks = await db.BacklogTasks.AsNoTracking().Where(t => t.UserId == user.UserId())
                .OrderBy(t => t.CreatedAt).ToListAsync();
            return tasks.Select(TaskResponse.From);
        });

        g.MapPost("", async (TaskRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            if (!await db.OwnsAreaAsync(uid, req.FocusAreaId)) return HttpExtensions.Invalid("focusAreaId", "That focus area does not exist.");
            var task = new BacklogTask { UserId = uid };
            Apply(task, req);
            db.BacklogTasks.Add(task);
            await db.SaveChangesAsync();
            return Results.Created($"/api/backlog/{task.Id}", TaskResponse.From(task));
        });

        g.MapPut("/{id:guid}", async (Guid id, TaskRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            var task = await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == uid);
            if (task is null) return Results.NotFound();
            if (!await db.OwnsAreaAsync(uid, req.FocusAreaId)) return HttpExtensions.Invalid("focusAreaId", "That focus area does not exist.");
            Apply(task, req);
            await db.SaveChangesAsync();
            return Results.Ok(TaskResponse.From(task));
        });

        g.MapDelete("/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db) =>
        {
            var task = await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == id && t.UserId == user.UserId());
            if (task is null) return Results.NotFound();
            db.BacklogTasks.Remove(task);
            await db.SaveChangesAsync();
            return Results.NoContent();
        });

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
                UserId = uid, Date = req.Date, Start = req.Start, End = req.End, Title = task.Title,
                FocusAreaId = task.FocusAreaId, Priority = task.Priority, WorkMode = req.WorkMode, IsOutside = task.IsOutside,
                Notes = task.NextStep.Length > 0 ? $"Next step: {task.NextStep}" : "", BacklogTaskId = task.Id,
            };
            task.ScheduledDate = req.Date;
            task.WorkMode = req.WorkMode;
            db.TimeBlocks.Add(block);
            await db.SaveChangesAsync();
            return Results.Created($"/api/blocks/{block.Id}", new { task = TaskResponse.From(task), block = BlockResponse.From(block) });
        });
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
    }
}
