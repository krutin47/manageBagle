using System.ComponentModel.DataAnnotations;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.Json.Serialization;
using ManageBagle.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Application.Planning;

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

public record OutcomeResponse(int Rank, string Result, Guid? FocusAreaId, string NextAction, ItemStatus Status, int? MinutesNeeded, Guid? BacklogTaskId)
{
    public static OutcomeResponse From(DailyOutcome o) => new(o.Rank, o.Result, o.FocusAreaId, o.NextAction, o.Status, o.MinutesNeeded, o.BacklogTaskId);
}

public record PlanResponse(int TasksCreated, int BlocksBooked, int LeftInBacklog, IReadOnlyList<OutcomeResponse> Outcomes);

/// <summary>
/// Use case: "plan my day". Captures tasks, books the ones with a time, and names the top three —
/// all in one transaction (ADR-011). Knows nothing about HTTP.
/// </summary>
public sealed class PlanDay(AppDbContext db, TimeProvider clock)
{
    public sealed record Command(Guid UserId, DateOnly Date, IReadOnlyList<PlanItem> Items, string? IdempotencyKey);

    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web) { Converters = { new JsonStringEnumConverter() } };

    public async Task<Result<PlanResponse>> HandleAsync(Command command, CancellationToken ct)
    {
        var (uid, date, items, key) = command;

        // Replay safety: the same key and the same plan return the first answer; a different plan is a mistake.
        string? requestHash = null;
        if (!string.IsNullOrWhiteSpace(key))
        {
            if (key.Length > 64) return Failure.Invalid("Idempotency-Key", "Use a key of at most 64 characters.");
            requestHash = Convert.ToHexString(SHA256.HashData(JsonSerializer.SerializeToUtf8Bytes(new { date, Items = items }, Json)));
            var now = clock.GetUtcNow();
            var seen = await db.IdempotencyRecords.AsNoTracking().FirstOrDefaultAsync(r => r.UserId == uid && r.Key == key && r.ExpiresAt > now, ct);
            if (seen is not null)
            {
                return seen.RequestHash == requestHash
                    ? JsonSerializer.Deserialize<PlanResponse>(seen.ResponseJson, Json)!
                    : Failure.Conflict("idempotency_key_reused", "This request key was already used for a different plan.");
            }
            await db.IdempotencyRecords.Where(r => r.ExpiresAt <= now).ExecuteDeleteAsync(ct);
        }

        if (Validate(items) is { } invalid) return invalid;

        var areaIds = items.Where(i => i.FocusAreaId is not null).Select(i => i.FocusAreaId!.Value).Distinct().ToList();
        if (await db.FocusAreas.CountAsync(a => a.UserId == uid && areaIds.Contains(a.Id), ct) != areaIds.Count)
        {
            return Failure.Invalid("items", "One of the focus areas does not exist.");
        }

        // Ownership: a task id from the browser counts only if it is this account's.
        var taskIds = items.Where(i => i.TaskId is not null).Select(i => i.TaskId!.Value).Distinct().ToList();
        var existing = await db.BacklogTasks.Where(t => t.UserId == uid && taskIds.Contains(t.Id)).ToDictionaryAsync(t => t.Id, ct);
        if (existing.Count != taskIds.Count) return Failure.Invalid("items", "One of the tasks no longer exists.");

        var zone = await db.Users.Where(u => u.Id == uid).Select(u => u.TimeZoneId).FirstOrDefaultAsync(ct);
        var outcomes = await db.DailyOutcomes.Where(o => o.UserId == uid && o.Date == date).ToListAsync(ct);
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
                if (block.Schedule(date, start, end, zone) is { } gap) return Failure.NonexistentTime(gap);
                db.TimeBlocks.Add(block);
                task.ScheduledDate = date;
                booked++;
            }

            if (item.TopRank is { } rank)
            {
                var outcome = outcomes.FirstOrDefault(o => o.Rank == rank);
                if (outcome is null)
                {
                    outcome = new DailyOutcome { UserId = uid, Date = date, Rank = rank };
                    db.DailyOutcomes.Add(outcome);
                    outcomes.Add(outcome);
                }
                outcome.Result = task.Title;
                outcome.FocusAreaId = task.FocusAreaId;
                outcome.NextAction = task.NextStep;
                outcome.Status = ItemStatus.Planned;
                outcome.MinutesNeeded = item.EstimatedMinutes;
                outcome.BacklogTaskId = task.Id;
            }
        }

        var response = new PlanResponse(created, booked, items.Count - booked, outcomes.OrderBy(o => o.Rank).Select(OutcomeResponse.From).ToList());
        if (requestHash is not null)
        {
            db.IdempotencyRecords.Add(new IdempotencyRecord
            {
                UserId = uid, Key = key!, RequestHash = requestHash,
                ResponseJson = JsonSerializer.Serialize(response, Json), ExpiresAt = clock.GetUtcNow().AddHours(24),
            });
        }

        // One transaction: tasks, blocks, outcomes and the replay record land together or not at all.
        // Two plans racing for the same day collide on a unique index; the exception handler answers 409.
        await db.SaveChangesAsync(ct);
        return response;
    }

    private static Failure? Validate(IReadOnlyList<PlanItem> items)
    {
        var ranks = items.Where(i => i.TopRank is not null).Select(i => i.TopRank!.Value).ToList();
        if (ranks.Count != ranks.Distinct().Count()) return Failure.Invalid("items", "Each top-three rank can be used once.");
        foreach (var item in items)
        {
            if (item.Start is null != item.End is null) return Failure.Invalid("items", "A booked item needs both a start and an end.");
            if (item.Start is { } s && item.End is { } e && (s == e || s.Minute % 5 != 0 || e.Minute % 5 != 0))
            {
                return Failure.Invalid("items", "Use 5-minute steps, and an end that differs from the start.");
            }
        }
        return null;
    }
}
