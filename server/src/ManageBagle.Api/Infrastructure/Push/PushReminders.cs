using ManageBagle.Api.Data;
using ManageBagle.Api.Domain;
using ManageBagle.Api.Features;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Infrastructure.Push;

/// <summary>
/// Sends the reminders that fell due in the last few minutes to everyone with a push subscription
/// (P2-C5, ADR-019): water, meals, and "time's up" for a running focus timer. Each reminder is
/// recorded before it is sent and the record is unique, so several instances, or a run repeated
/// after a restart, never send it twice. Payloads are end-to-end encrypted to the browser; the push
/// service cannot read them.
/// </summary>
public sealed class PushReminders(AppDbContext db, PushService push, TimeProvider clock)
{
    /// <summary>How far back a run looks: covers a missed minute or a restart, but nothing stale.</summary>
    public static readonly TimeSpan Lookback = TimeSpan.FromMinutes(3);

    public async Task<int> RunAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var userIds = await db.PushSubscriptions.Select(s => s.UserId).Distinct().ToListAsync(ct);
        if (userIds.Count == 0) return 0;

        var users = await db.Users.AsNoTracking().Where(u => userIds.Contains(u.Id))
            .Select(u => new { u.Id, u.TimeZoneId, u.DayStart, u.DayEnd, u.WaterReminderMinutes }).ToListAsync(ct);
        var meals = await db.Routines.AsNoTracking().Include(r => r.Areas).Where(r => userIds.Contains(r.UserId) && r.IsMeal).ToListAsync(ct);
        var timers = await db.TimeBlocks.AsNoTracking().Where(b => userIds.Contains(b.UserId) && b.TimerStartedAt != null).ToListAsync(ct);
        var subscriptions = await db.PushSubscriptions.AsNoTracking().Where(s => userIds.Contains(s.UserId)).ToListAsync(ct);

        var due = new List<(Guid User, string Key, DateTimeOffset DueAt, PushMessage Message)>();
        foreach (var user in users)
        {
            var zone = TimeZones.Find(user.TimeZoneId) ?? TimeZoneInfo.Utc;
            var local = TimeZoneInfo.ConvertTime(now, zone);
            var today = DateOnly.FromDateTime(local.DateTime);
            var upTo = (int)local.TimeOfDay.TotalMinutes;
            var plan = new ReminderPlan(
                Minutes(user.DayStart ?? RoutineEndpoints.DefaultDayStart), Minutes(user.DayEnd ?? RoutineEndpoints.DefaultDayEnd), user.WaterReminderMinutes,
                RoutineSchedule.Expand(meals.Where(r => r.UserId == user.Id).Select(r => r.ToRule()), today, today, zone)
                    .Where(o => o.Date == today).Select(o => (o.Title, Minutes(o.Start))).ToList());
            var dayKey = new DateTimeOffset(today.ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
            foreach (var r in ReminderSchedule.Between(upTo - (int)Lookback.TotalMinutes, upTo, plan))
            {
                due.Add((user.Id, r.Key, dayKey, new PushMessage(r.Title, r.Body, r.Key)));
            }

            foreach (var block in timers.Where(t => t.UserId == user.Id))
            {
                var limit = (block.PlannedMinutes + block.ExtendedMinutes) * 60;
                var dueAt = block.TimerStartedAt!.Value.AddSeconds(limit - block.TrackedSeconds);
                if (dueAt <= now && dueAt > now - Lookback)
                {
                    due.Add((user.Id, $"timeup-{block.Id}-{limit}", dueAt, new PushMessage("Time's up", $"{block.Title} — need more time?", $"timeup-{block.Id}")));
                }
            }
        }

        var sent = 0;
        foreach (var (user, key, dueAt, message) in due)
        {
            db.PushDeliveries.Add(new PushDelivery { UserId = user, Key = key, DueAt = dueAt, SentAt = now });
            try
            {
                await db.SaveChangesAsync(ct);
            }
            catch (DbUpdateException)
            {
                db.ChangeTracker.Clear(); // already sent by another instance or an earlier run
                continue;
            }
            foreach (var subscription in subscriptions.Where(s => s.UserId == user))
            {
                if (await push.SendAsync(subscription, message, ct) == PushOutcome.Sent) sent++;
            }
        }

        await db.PushDeliveries.Where(d => d.SentAt < now.AddDays(-2)).ExecuteDeleteAsync(ct);
        return sent;
    }

    private static int Minutes(TimeOnly t) => t.Hour * 60 + t.Minute;
}

/// <summary>Runs <see cref="PushReminders"/> once a minute (Push:SchedulerEnabled, default true).</summary>
public sealed class PushReminderService(IServiceScopeFactory scopes, TimeProvider clock, ILogger<PushReminderService> log) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromMinutes(1), clock);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<PushReminders>().RunAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning(e, "Sending reminders failed; the next run will retry what is still due");
            }
        }
    }
}
