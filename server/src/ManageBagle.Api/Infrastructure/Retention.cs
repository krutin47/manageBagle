using ManageBagle.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Infrastructure;

/// <summary>
/// Deletes account activity older than Retention:AuditMonths (handbook §17.3; docs/data-inventory.md).
/// 0, the default, keeps everything until a retention period is agreed. Runs shortly after start and
/// then daily; safe to run on every instance at once because the delete is idempotent.
/// </summary>
public sealed class RetentionService(IServiceScopeFactory scopes, IConfiguration config, TimeProvider clock, ILogger<RetentionService> log) : BackgroundService
{
    public static async Task<int> PurgeAsync(AppDbContext db, int auditMonths, DateTimeOffset now, CancellationToken ct)
    {
        if (auditMonths <= 0) return 0;
        var cutoff = now.AddMonths(-auditMonths);
        // AI usage records (cost only, no text) follow the same period.
        return await db.AuditEvents.Where(e => e.At < cutoff).ExecuteDeleteAsync(ct)
            + await db.AiUsage.Where(u => u.At < cutoff).ExecuteDeleteAsync(ct);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var months = config.GetValue("Retention:AuditMonths", 0);
        if (months <= 0) return;
        try { await Task.Delay(TimeSpan.FromMinutes(1), clock, stoppingToken); } catch (OperationCanceledException) { return; }
        using var timer = new PeriodicTimer(TimeSpan.FromDays(1), clock);
        do
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var removed = await PurgeAsync(scope.ServiceProvider.GetRequiredService<AppDbContext>(), months, clock.GetUtcNow(), stoppingToken);
                if (removed > 0) log.LogInformation("Retention removed {Count} account activity entries older than {Months} months", removed, months);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                log.LogWarning(e, "Retention run failed; it will be retried tomorrow");
            }
        } while (await timer.WaitForNextTickAsync(stoppingToken));
    }
}
