namespace ManageBagle.Api.Infrastructure;

/// <summary>
/// For browser tests only: a clock that can be moved forward, so "time's up" can be tested without
/// waiting. Registered only when <c>Testing:ClockControl</c> is true, and never in Production — the
/// app refuses to start if both are set.
/// </summary>
public sealed class ShiftableClock : TimeProvider
{
    private long _offsetTicks;

    public override DateTimeOffset GetUtcNow() => base.GetUtcNow().AddTicks(Interlocked.Read(ref _offsetTicks));

    public void Advance(TimeSpan by) => Interlocked.Add(ref _offsetTicks, by.Ticks);
}

public static class TestClock
{
    public static bool Enabled(IConfiguration config) => config.GetValue("Testing:ClockControl", false);

    public static void AddTestClock(this IServiceCollection services, IHostEnvironment env)
    {
        if (env.IsProduction()) throw new InvalidOperationException("Testing:ClockControl must never be enabled in Production.");
        var clock = new ShiftableClock();
        services.AddSingleton(clock);
        services.AddSingleton<TimeProvider>(clock);
    }

    public static void MapTestClock(this IEndpointRouteBuilder app) =>
        app.MapPost("/api/testing/clock/advance", (AdvanceRequest req, ShiftableClock clock) =>
        {
            clock.Advance(TimeSpan.FromSeconds(req.Seconds));
            return Results.Ok(new { now = clock.GetUtcNow() });
        }).ExcludeFromDescription();

    public record AdvanceRequest(int Seconds);
}
