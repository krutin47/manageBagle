using ManageBagle.Api.Data;
using ManageBagle.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Application.Timing;

/// <summary>
/// Use cases for the focus timer (P2-B, ADR-013). Every action answers with the block as it now is and
/// the server's clock, so a device whose clock is off still shows the right elapsed time.
/// </summary>
public sealed class FocusTimer(AppDbContext db, TimeProvider clock)
{
    public sealed record Snapshot(TimeBlock Block, DateTimeOffset ServerNow, Guid? PausedBlockId = null);

    public async Task<Snapshot?> RunningAsync(Guid userId, CancellationToken ct)
    {
        var running = await db.TimeBlocks.AsNoTracking().FirstOrDefaultAsync(b => b.UserId == userId && b.TimerStartedAt != null, ct);
        return running is null ? null : new Snapshot(running, clock.GetUtcNow());
    }

    /// <summary>
    /// Starts (or resumes) a block. If another block is running, the caller must say it may be paused;
    /// otherwise the answer is a conflict naming the running block, so the screen can ask.
    /// </summary>
    public async Task<Result<Snapshot>> StartAsync(Guid userId, Guid blockId, bool pauseRunning, CancellationToken ct)
    {
        var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == blockId && b.UserId == userId, ct);
        if (block is null) return Failure.NotFound();
        if (block.Status is ItemStatus.Done or ItemStatus.Skipped) return Failure.Conflict("block_closed", "This block is already closed. Reopen it to time it again.");

        var now = clock.GetUtcNow();
        var running = await db.TimeBlocks.FirstOrDefaultAsync(b => b.UserId == userId && b.TimerStartedAt != null && b.Id != blockId, ct);
        if (running is not null)
        {
            if (!pauseRunning)
            {
                return new Failure(FailureKind.Conflict, "timer_already_running", $"“{running.Title}” is already running. Pause it to start this one.",
                    Extra: new Dictionary<string, object?> { ["runningBlockId"] = running.Id, ["runningTitle"] = running.Title });
            }
            running.PauseTimer(now);
            // Banked before starting the other, so the "one running timer" index is never violated mid-save.
            await db.SaveChangesAsync(ct);
        }

        block.StartTimer(now);
        // A race with another device starting a timer at the same instant is caught by the unique index (409).
        await db.SaveChangesAsync(ct);
        return new Snapshot(block, now, running?.Id);
    }

    public async Task<Result<Snapshot>> PauseAsync(Guid userId, Guid blockId, CancellationToken ct)
    {
        var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == blockId && b.UserId == userId, ct);
        if (block is null) return Failure.NotFound();
        var now = clock.GetUtcNow();
        block.PauseTimer(now);
        await db.SaveChangesAsync(ct);
        return new Snapshot(block, now);
    }

    public async Task<Result<Snapshot>> ExtendAsync(Guid userId, Guid blockId, int minutes, CancellationToken ct)
    {
        if (minutes is not (5 or 10 or 15 or 30 or 45 or 60)) return Failure.Invalid("minutes", "Add 5, 10, 15, 30, 45 or 60 minutes.");
        var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == blockId && b.UserId == userId, ct);
        if (block is null) return Failure.NotFound();
        if (block.ExtendedMinutes + minutes > 8 * 60) return Failure.Invalid("minutes", "A block can be extended by at most 8 hours.");
        block.ExtendedMinutes += minutes;
        await db.SaveChangesAsync(ct);
        return new Snapshot(block, clock.GetUtcNow());
    }

    /// <summary>
    /// Ends a block and says why (P2-B5). The time worked is always kept. What happens to the linked
    /// task and top-three outcome depends on the answer.
    /// </summary>
    public async Task<Result<Snapshot>> StopAsync(Guid userId, Guid blockId, StopOutcome outcome, string? note, CancellationToken ct)
    {
        var block = await db.TimeBlocks.FirstOrDefaultAsync(b => b.Id == blockId && b.UserId == userId, ct);
        if (block is null) return Failure.NotFound();
        if (note?.Length > 500) return Failure.Invalid("note", "Keep the note under 500 characters.");

        var now = clock.GetUtcNow();
        block.PauseTimer(now);
        block.StopNote = note?.Trim() ?? "";
        block.Status = outcome == StopOutcome.Finished ? ItemStatus.Done : ItemStatus.Skipped;
        block.FinishedAt = outcome == StopOutcome.Finished ? now : null;

        var task = block.BacklogTaskId is { } taskId
            ? await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.UserId == userId, ct)
            : null;
        var otherSessions = block.BacklogTaskId is null ? [] : await db.TimeBlocks.AsNoTracking()
            .Where(b => b.UserId == userId && b.BacklogTaskId == block.BacklogTaskId && b.Id != block.Id)
            .Select(b => new { b.Date, b.Status }).ToListAsync(ct);
        var outcomes = block.BacklogTaskId is null ? [] : await db.DailyOutcomes
            .Where(o => o.UserId == userId && o.Date == block.Date && o.BacklogTaskId == block.BacklogTaskId).ToListAsync(ct);

        switch (outcome)
        {
            case StopOutcome.Finished:
                if (task is not null) task.Status = TaskCompletion.AfterSessionFinished(task.Status, otherSessions.Select(o => o.Status));
                if (!otherSessions.Where(o => o.Date == block.Date).Any(o => TaskCompletion.IsOpen(o.Status)))
                {
                    foreach (var o in outcomes) o.Status = ItemStatus.Done;
                }
                break;

            case StopOutcome.Later:
                // Back to the backlog, unscheduled, so it shows up in "Due soon" and brain-dump suggestions.
                if (task is null)
                {
                    task = new BacklogTask { UserId = userId, Title = block.Title, FocusAreaId = block.FocusAreaId, Priority = block.Priority, WorkMode = block.WorkMode, IsOutside = block.IsOutside };
                    db.BacklogTasks.Add(task);
                }
                task.Status = block.TrackedSeconds >= 30 ? ItemStatus.InProgress : ItemStatus.Planned;
                task.ScheduledDate = null;
                task.EstimatedMinutes = Math.Max(5, block.PlannedMinutes - (block.ActualMinutes ?? 0));
                foreach (var o in outcomes) o.Status = ItemStatus.InProgress;
                break;

            case StopOutcome.Drop:
                if (task is not null) task.Status = ItemStatus.Skipped;
                foreach (var o in outcomes) o.Status = ItemStatus.Skipped;
                break;
        }

        await db.SaveChangesAsync(ct);
        return new Snapshot(block, now);
    }
}
