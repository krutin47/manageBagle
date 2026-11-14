using ManageBagle.Api.Data;
using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace ManageBagle.Api.Infrastructure;

/// <summary>Not ready to serve until the database schema matches this build.</summary>
public sealed class SchemaHealthCheck(AppDbContext db) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        var pending = (await db.Database.GetPendingMigrationsAsync(ct)).Count();
        return pending == 0
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy($"{pending} database migration(s) have not been applied. Run the app with --migrate.");
    }
}

public static class Health
{
    private const string Ready = "ready";

    public static IServiceCollection AddAppHealthChecks(this IServiceCollection services)
    {
        services.AddHealthChecks()
            .AddDbContextCheck<AppDbContext>("database", tags: [Ready])
            .AddCheck<SchemaHealthCheck>("schema", tags: [Ready]);
        return services;
    }

    public static void MapAppHealthChecks(this IEndpointRouteBuilder app)
    {
        // Liveness: the process is up. It deliberately ignores the database, so a brief database
        // outage does not make the platform restart every replica.
        app.MapHealthChecks("/health/live", new HealthCheckOptions { Predicate = _ => false });
        // Readiness: safe to send traffic — database reachable and schema current.
        var ready = new HealthCheckOptions { Predicate = c => c.Tags.Contains(Ready) };
        app.MapHealthChecks("/health/ready", ready);
        app.MapHealthChecks("/healthz", ready); // earlier name, kept for existing probes
    }
}
