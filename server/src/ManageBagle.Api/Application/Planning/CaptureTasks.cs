using System.ComponentModel.DataAnnotations;
using ManageBagle.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Application.Planning;

/// <summary>One line of a brain dump: a task with whatever details were given. Nothing is scheduled.</summary>
public record CaptureItem(
    [Required, StringLength(200, MinimumLength = 1)] string Title,
    [Range(5, 1440)] int? EstimatedMinutes,
    Guid? FocusAreaId,
    WorkMode WorkMode,
    bool IsOutside,
    Priority Priority,
    Priority Impact,
    DateOnly? DueDate,
    [Range(0, 60)] int? BreakMinutes);

/// <summary>
/// Use case: the brain dump (P2-E1). Saves every captured line to the backlog in one transaction.
/// It deliberately books no time and picks no top three — that is planning (P2-E2).
/// </summary>
public sealed class CaptureTasks(AppDbContext db)
{
    public const int MaxItems = 60;

    public async Task<Result<IReadOnlyList<BacklogTask>>> HandleAsync(Guid userId, IReadOnlyList<CaptureItem> items, CancellationToken ct)
    {
        if (items.Count is 0 or > MaxItems) return Failure.Invalid("items", $"Capture between 1 and {MaxItems} tasks at a time.");
        // Checked here as well as by the attributes: nested items are not always validated by the framework.
        if (items.Any(i => string.IsNullOrWhiteSpace(i.Title) || i.Title.Trim().Length > 200)) return Failure.Invalid("items", "Every task needs a title of up to 200 characters.");
        if (items.Any(i => i.EstimatedMinutes is < 5 or > 1440 || i.BreakMinutes is < 0 or > 60)) return Failure.Invalid("items", "A length is 5 minutes to a day; a break up to an hour.");
        var areaIds = items.Where(i => i.FocusAreaId is not null).Select(i => i.FocusAreaId!.Value).Distinct().ToList();
        if (await db.FocusAreas.CountAsync(a => a.UserId == userId && areaIds.Contains(a.Id), ct) != areaIds.Count)
        {
            return Failure.Invalid("items", "One of the focus areas does not exist.");
        }
        var tasks = items.Select(i => new BacklogTask
        {
            UserId = userId, Title = i.Title.Trim(), EstimatedMinutes = i.EstimatedMinutes, FocusAreaId = i.FocusAreaId, WorkMode = i.WorkMode,
            IsOutside = i.IsOutside, Priority = i.Priority, Impact = i.Impact, DueDate = i.DueDate, BreakMinutes = i.BreakMinutes, Status = ItemStatus.Planned,
        }).ToList();
        db.BacklogTasks.AddRange(tasks);
        await db.SaveChangesAsync(ct);
        return tasks;
    }
}
