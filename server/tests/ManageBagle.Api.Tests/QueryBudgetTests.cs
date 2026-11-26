using System.Data.Common;
using System.Net.Http.Json;
using System.Text.Json;
using ManageBagle.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.Extensions.DependencyInjection;
using Xunit.Abstractions;

namespace ManageBagle.Api.Tests;

/// <summary>Counts every SQL command the API sends.</summary>
public sealed class CommandCounter : DbCommandInterceptor
{
    private int _count;
    public int Count => _count;
    public void Reset() => Interlocked.Exchange(ref _count, 0);
    public override ValueTask<InterceptionResult<DbDataReader>> ReaderExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<DbDataReader> result, CancellationToken ct = default) { Interlocked.Increment(ref _count); return base.ReaderExecutingAsync(command, eventData, result, ct); }
    public override ValueTask<InterceptionResult<int>> NonQueryExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<int> result, CancellationToken ct = default) { Interlocked.Increment(ref _count); return base.NonQueryExecutingAsync(command, eventData, result, ct); }
    public override ValueTask<InterceptionResult<object>> ScalarExecutingAsync(DbCommand command, CommandEventData eventData, InterceptionResult<object> result, CancellationToken ct = default) { Interlocked.Increment(ref _count); return base.ScalarExecutingAsync(command, eventData, result, ct); }
}

public sealed class CountingFactory : ApiFactory
{
    public CommandCounter Commands { get; } = new();
    // As in production: the session is re-checked against the database once a minute, not on every request.
    protected override IEnumerable<(string Key, string Value)> ExtraSettings => [("Auth:SessionRevalidateSeconds", "60")];

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services => services.ConfigureDbContext<AppDbContext>(o => o.AddInterceptors(Commands)));
    }
}

/// <summary>
/// Handbook Phase 0, "trace the user journeys with SQL counts". Each journey makes the same requests
/// as the screen, and the number of SQL commands it costs is held to a budget, so an accidental
/// N+1 query or a duplicated lookup fails the build. Measured counts are printed and recorded in
/// docs/performance.md.
/// </summary>
public class QueryBudgetTests(CountingFactory factory, ITestOutputHelper output) : IClassFixture<CountingFactory>
{
    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        var text = await r.Content.ReadAsStringAsync();
        return text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone();
    }

    [Fact]
    public async Task Each_journey_stays_within_its_query_budget()
    {
        var (client, _) = await factory.NewUserAsync();
        const string day = "2026-11-26", from = "2026-11-23", to = "2026-11-29";
        var items = Enumerable.Range(0, 6).Select(n => new { title = $"Task {n}", estimatedMinutes = 30, workMode = "ShallowWork", priority = "Medium", topRank = n < 3 ? n + 1 : (int?)null, start = $"{14 + n:00}:00:00", end = $"{14 + n:00}:30:00" }).ToArray();
        await Json(await client.PostAsJsonAsync("/api/routines", new { title = "Lunch", days = "Everyday", start = "12:30:00", end = "13:15:00", taskPolicy = "NoTasks", areaIds = (Guid[]?)null, isMeal = true }));

        async Task OpenToday()
        {
            foreach (var path in new[] { "/api/auth/me", $"/api/days/{day}", $"/api/blocks?from={from}&to={to}", "/api/backlog", $"/api/commitments?from={from}&to={to}", "/api/timer", "/api/preferences" })
                Assert.True((await client.GetAsync(path)).IsSuccessStatusCode, path);
        }
        async Task OpenPlanner()
        {
            foreach (var path in new[] { $"/api/blocks?from={from}&to={to}", $"/api/commitments?from={from}&to={to}", "/api/areas" })
                Assert.True((await client.GetAsync(path)).IsSuccessStatusCode, path);
        }
        Task PlanDay() => Json(client.PostAsJsonAsync($"/api/days/{day}/plan", new { items }).Result);
        async Task TickBlock()
        {
            var block = (await client.GetFromJsonAsync<JsonElement>($"/api/blocks?from={day}&to={day}"))[1];
            factory.Commands.Reset(); // measure the write, not the read that found the block
            await Json(await client.PatchAsJsonAsync($"/api/blocks/{block.GetProperty("id").GetGuid()}/progress", new { status = "Done", version = block.GetProperty("version").GetInt32() }));
        }
        Task BrainDump() => Json(client.PostAsJsonAsync("/api/backlog/capture", new { items = new[] { "One", "Two", "Three" }.Select(t => new { title = t, workMode = "ShallowWork", priority = "Low", impact = "Low" }) }).Result);
        Task OpenWeek() => Json(client.GetAsync($"/api/summary/week?start={from}").Result);

        // journey, budget (measured on 2026-11-25 + 1), action
        var journeys = new (string Name, int Budget, Func<Task> Run)[]
        {
            ("Plan a day (6 tasks)", 9, PlanDay),
            ("Open Today (7 requests)", 12, OpenToday),
            ("Open Planner (3 requests)", 6, OpenPlanner),
            ("Tick a block", 6, TickBlock),
            ("Brain dump (3 tasks)", 3, BrainDump),
            ("Open Week", 2, OpenWeek),
        };

        await OpenToday(); // warm-up: key ring and model building are one-off costs, not per journey
        var measured = new List<string>();
        foreach (var (name, budget, run) in journeys)
        {
            factory.Commands.Reset();
            await run();
            var count = factory.Commands.Count;
            measured.Add($"{name}: {count} SQL commands (budget {budget})");
            output.WriteLine(measured[^1]);
            Assert.True(count <= budget, $"{name} used {count} SQL commands; budget {budget}.\n" + string.Join("\n", measured));
        }
    }
}
