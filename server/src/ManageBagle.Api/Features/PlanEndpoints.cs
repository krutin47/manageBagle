using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Mvc;
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
    TimeOnly? End,
    Priority Impact = Priority.Medium,
    DateOnly? DueDate = null);

public record PlanRequest([Required, MinLength(1), MaxLength(40)] PlanItem[] Items);

public record PlanResponse(int TasksCreated, int BlocksBooked, int LeftInBacklog, IReadOnlyList<OutcomeResponse> Outcomes);

public static class PlanEndpoints
{
    private static readonly JsonSerializerOptions HashJson = new(JsonSerializerDefaults.Web);
    private static readonly JsonSerializerOptions ResponseJson = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public static void MapPlanEndpoints(this IEndpointRouteBuilder app)
    {
        // "Plan my day": capture tasks, name the top three, and book the lot in one atomic save.
        // Replay-safe: with an Idempotency-Key header, sending the same plan twice (a double click, a
        // retry after a dropped connection) saves it once and returns the first answer again.
        app.MapPost("/api/days/{date}/plan", async (DateOnly date, PlanRequest req, [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
            ClaimsPrincipal user, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var items = req.Items;

            string? requestHash = null;
            if (!string.IsNullOrWhiteSpace(idempotencyKey))
            {
                if (idempotencyKey.Length > 64) return HttpExtensions.Invalid("Idempotency-Key", "Use a key of at most 64 characters.");
                requestHash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { date, req.Items }, HashJson)));
                var now = clock.GetUtcNow();
                var seen = await db.IdempotencyRecords.AsNoTracking().FirstOrDefaultAsync(r => r.UserId == uid && r.Key == idempotencyKey && r.ExpiresAt > now, ct);
                if (seen is not null)
                {
                    return seen.RequestHash == requestHash
                        ? Results.Content(seen.ResponseJson, "application/json")
                        : HttpExtensions.Problem(StatusCodes.Status409Conflict, ErrorCodes.IdempotencyKeyReused, "This request key was already used for a different plan.");
                }
                await db.IdempotencyRecords.Where(r => r.ExpiresAt <= now).ExecuteDeleteAsync(ct);
            }
            var zone = await db.TimeZoneOf(uid, ct);

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
                task.Priority = item.Priority;
                task.Impact = item.Impact;
                task.DueDate = item.DueDate;

                if (item.Start is { } start && item.End is { } end)
                {
                    var block = new TimeBlock
                    {
                        UserId = uid, Title = task.Title, FocusAreaId = task.FocusAreaId,
                        Priority = task.Priority, WorkMode = task.WorkMode, IsOutside = task.IsOutside, BacklogTaskId = task.Id,
                        Notes = task.NextStep.Length > 0 ? $"Next step: {task.NextStep}" : "",
                    };
                    if (block.Schedule(date, start, end, zone) is { } gap) return BlockEndpoints.NonexistentTime(gap);
                    db.TimeBlocks.Add(block);
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

            var response = new PlanResponse(created, booked, items.Length - booked, currentOutcomes.OrderBy(o => o.Rank).Select(DayEndpoints.ToResponse).ToList());
            if (requestHash is not null)
            {
                db.IdempotencyRecords.Add(new IdempotencyRecord
                {
                    UserId = uid, Key = idempotencyKey!, RequestHash = requestHash,
                    ResponseJson = JsonSerializer.Serialize(response, ResponseJson), ExpiresAt = clock.GetUtcNow().AddHours(24),
                });
            }

            // One transaction: tasks, blocks, outcomes and the replay record land together or not at all.
            // Two plans racing for the same day collide on a unique index and one is answered 409.
            await db.SaveChangesAsync(ct);
            return Results.Ok(response);
        }).RequireAuthorization().WithTags("Daily focus").Produces<PlanResponse>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);
    }
}
