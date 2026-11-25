using ManageBagle.Api.Data;
using ManageBagle.Api.Domain;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Application.Tasks;

/// <summary>
/// Use case: a task's status was set directly — on the board, or by dropping it — so its sessions
/// follow (P2-G1, board → Today). A task finished or dropped must not stay on today's plan.
///   - Finished: open sessions up to today are finished; later ones are no longer needed and are dropped.
///   - Dropped: every open session is dropped.
/// Running timers bank their time first. Linked top-three outcomes take the task's state.
/// Reopening a task changes no blocks: what was finished stays finished.
/// </summary>
public sealed class ChangeTaskStatus(AppDbContext db, TimeProvider clock)
{
    public async Task FollowAsync(BacklogTask task, ItemStatus previous, CancellationToken ct)
    {
        if (task.Status == previous || task.Status is not (ItemStatus.Done or ItemStatus.Skipped)) return;
        var now = clock.GetUtcNow();
        var zoneId = await db.Users.Where(u => u.Id == task.UserId).Select(u => u.TimeZoneId).FirstOrDefaultAsync(ct);
        var zone = TimeZones.Find(zoneId) ?? TimeZoneInfo.Utc;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(now, zone).DateTime);

        var open = await db.TimeBlocks
            .Where(b => b.UserId == task.UserId && b.BacklogTaskId == task.Id && (b.Status == ItemStatus.Planned || b.Status == ItemStatus.InProgress))
            .ToListAsync(ct);
        foreach (var block in open)
        {
            block.PauseTimer(now);
            block.Status = task.Status == ItemStatus.Done && block.Date <= today ? ItemStatus.Done : ItemStatus.Skipped;
            if (block.Status == ItemStatus.Done) block.FinishedAt ??= now;
        }

        var outcomes = await db.DailyOutcomes
            .Where(o => o.UserId == task.UserId && o.BacklogTaskId == task.Id && (o.Status == ItemStatus.Planned || o.Status == ItemStatus.InProgress))
            .ToListAsync(ct);
        foreach (var outcome in outcomes) outcome.Status = task.Status;
    }
}
