using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

/// <summary>
/// One line of a day plan. With <see cref="TaskId"/> it refers to an existing backlog task; without,
/// a new task is captured. Start/End book it on the calendar; without them it stays in the backlog.
/// </summary>
public record PlanItem(
    Guid? TaskId,
    [Required, StringLength(200, MinimumLength = 1)] string Title,
    [Range(5, 1440)] int EstimatedMinutes,
    Guid? FocusAreaId,
    WorkMode WorkMode,
    bool IsOutside,
    Priority Priority,
    [Range(1, 3)] int? TopRank,
    TimeOnly? Start,
    TimeOnly? End);

public record PlanRequest([Required, MinLength(1), MaxLength(40)] PlanItem[] Items);

public record PlanResponse(int TasksCreated, int BlocksBooked, int LeftInBacklog, IEnumerable<OutcomeResponse> Outcomes);

public static class PlanEndpoints
{
    public static void MapPlanEndpoints(this IEndpointRouteBuilder app)
    {
        // "Plan my day": capture tasks, name the top three, and book the lot in one atomic save.
        app.MapPost("/api/days/{date}/plan", async (DateOnly date, PlanRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            var items = req.Items;

            var ranks = items.Where(i => i.TopRank is not null).Select(i => i.TopRank!.Value).ToList();
            if (ranks.Count != ranks.Distinct().Count()) return HttpExtensions.Invalid("items", "Each top-three rank can be used once.");
            foreach (var item in items)
            {
                if (item.Start is null != item.End is null) return HttpExtensions.Invalid("items", "A booked item needs both a start and an end.");
                if (item.Start is { } s && item.End is { } e && (s == e || s.Minute % 5 != 0 || e.Minute % 5 != 0))
                {
                    return HttpExtensions.Invalid("items", "Use 5-minute steps, and an end that differs from the start.");
                }
            }

            var areaIds = items.Where(i => i.FocusAreaId is not null).Select(i => i.FocusAreaId!.Value).Distinct().ToList();
            var ownedAreas = await db.FocusAreas.CountAsync(a => a.UserId == uid && areaIds.Contains(a.Id));
            if (ownedAreas != areaIds.Count) return HttpExtensions.Invalid("items", "One of the focus areas does not exist.");

            var taskIds = items.Where(i => i.TaskId is not null).Select(i => i.TaskId!.Value).Distinct().ToList();
            var existing = await db.BacklogTasks.Where(t => t.UserId == uid && taskIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id);
            if (existing.Count != taskIds.Count) return HttpExtensions.Invalid("items", "One of the tasks no longer exists.");

            var currentOutcomes = await db.DailyOutcomes.Where(o => o.UserId == uid && o.Date == date).ToListAsync();
            int created = 0, booked = 0;

            foreach (var item in items)
            {
                BacklogTask task;
                if (item.TaskId is { } id)
                {
                    task = existing[id];
                }
                else
                {
                    task = new BacklogTask { UserId = uid, Id = Guid.NewGuid() };
                    db.BacklogTasks.Add(task);
                    created++;
                }
                task.Title = item.Title.Trim();
                task.EstimatedMinutes = item.EstimatedMinutes;
                task.FocusAreaId = item.FocusAreaId;
                task.WorkMode = item.WorkMode;
                task.IsOutside = item.IsOutside;
                task.Priority = item.TopRank is not null ? Priority.High : item.Priority;

                if (item.Start is { } start && item.End is { } end)
                {
                    db.TimeBlocks.Add(new TimeBlock
                    {
                        UserId = uid, Date = date, Start = start, End = end, Title = task.Title, FocusAreaId = task.FocusAreaId,
                        Priority = task.Priority, WorkMode = task.WorkMode, IsOutside = task.IsOutside, BacklogTaskId = task.Id,
                        Notes = task.NextStep.Length > 0 ? $"Next step: {task.NextStep}" : "",
                    });
                    task.ScheduledDate = date;
                    booked++;
                }

                if (item.TopRank is { } rank)
                {
                    var outcome = currentOutcomes.FirstOrDefault(o => o.Rank == rank);
                    if (outcome is null)
                    {
                        outcome = new DailyOutcome { UserId = uid, Date = date, Rank = rank };
                        db.DailyOutcomes.Add(outcome);
                        currentOutcomes.Add(outcome);
                    }
                    outcome.Result = task.Title;
                    outcome.FocusAreaId = task.FocusAreaId;
                    outcome.NextAction = task.NextStep;
                    outcome.Status = ItemStatus.Planned;
                    outcome.MinutesNeeded = item.EstimatedMinutes;
                    outcome.BacklogTaskId = task.Id;
                }
            }

            await db.SaveChangesAsync(); // one transaction: the whole plan lands or none of it does
            return Results.Ok(new PlanResponse(created, booked, items.Length - booked,
                currentOutcomes.OrderBy(o => o.Rank).Select(DayEndpoints.ToResponse)));
        }).RequireAuthorization().WithTags("Daily focus");
    }
}
