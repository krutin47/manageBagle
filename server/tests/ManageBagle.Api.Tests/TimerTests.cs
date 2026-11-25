using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace ManageBagle.Api.Tests;

/// <summary>The real app, with a clock the tests move by hand.</summary>
public sealed class ClockedFactory : ApiFactory
{
    public FakeTimeProvider Clock { get; } = new(DateTimeOffset.UtcNow);

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services => services.AddSingleton<TimeProvider>(Clock));
    }
}

public class TimerTests(ClockedFactory factory) : IClassFixture<ClockedFactory>
{
    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static async Task<Guid> NewBlock(HttpClient client, string title = "Focus", string start = "09:00:00", string end = "10:00:00") =>
        (await Json(await client.PostAsJsonAsync("/api/blocks", new { date = "2026-11-26", start, end, title, priority = "High", workMode = "DeepFocus", status = "Planned" })))
            .GetProperty("id").GetGuid();

    private static Task<HttpResponseMessage> Start(HttpClient c, Guid id, bool pauseRunning = false) => c.PostAsJsonAsync($"/api/blocks/{id}/timer/start", new { pauseRunning });

    [Fact]
    public async Task Time_worked_is_recorded_as_actual_minutes_when_paused()
    {
        var (client, _) = await factory.NewUserAsync();
        var id = await NewBlock(client);

        var started = await Json(await Start(client, id));
        Assert.Equal("InProgress", started.GetProperty("block").GetProperty("status").GetString());
        var running = await client.GetFromJsonAsync<JsonElement>("/api/timer");
        Assert.Equal(id, running.GetProperty("block").GetProperty("id").GetGuid());

        factory.Clock.Advance(TimeSpan.FromMinutes(25));
        var paused = (await Json(await client.PostAsync($"/api/blocks/{id}/timer/pause", null))).GetProperty("block");
        Assert.Equal(25, paused.GetProperty("actualMinutes").GetInt32());
        Assert.Equal(1500, paused.GetProperty("trackedSeconds").GetInt32());
        Assert.Equal(JsonValueKind.Null, paused.GetProperty("timerStartedAt").ValueKind);
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/timer")).StatusCode);

        // Resuming adds to what was already banked.
        await Json(await Start(client, id));
        factory.Clock.Advance(TimeSpan.FromMinutes(10));
        var again = (await Json(await client.PostAsync($"/api/blocks/{id}/timer/pause", null))).GetProperty("block");
        Assert.Equal(35, again.GetProperty("actualMinutes").GetInt32());
    }

    [Fact]
    public async Task Only_one_timer_runs_at_a_time_and_switching_must_be_asked_for()
    {
        var (client, _) = await factory.NewUserAsync();
        var first = await NewBlock(client, "First");
        var second = await NewBlock(client, "Second", "10:00:00", "11:00:00");
        await Json(await Start(client, first));

        var refused = await Start(client, second);
        Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
        var problem = await refused.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("timer_already_running", problem.GetProperty("code").GetString());
        Assert.Equal(first, problem.GetProperty("runningBlockId").GetGuid());

        factory.Clock.Advance(TimeSpan.FromMinutes(5));
        var switched = await Json(await Start(client, second, pauseRunning: true));
        Assert.Equal(first, switched.GetProperty("pausedBlockId").GetGuid());
        var blocks = await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-26&to=2026-11-26");
        var firstNow = blocks.EnumerateArray().Single(b => b.GetProperty("id").GetGuid() == first);
        Assert.Equal(5, firstNow.GetProperty("actualMinutes").GetInt32());
        Assert.Equal(JsonValueKind.Null, firstNow.GetProperty("timerStartedAt").ValueKind);
    }

    [Fact]
    public async Task Two_devices_starting_different_blocks_at_once_still_leave_one_timer()
    {
        var (client, _) = await factory.NewUserAsync();
        var ids = new List<Guid>();
        for (var i = 0; i < 5; i++) ids.Add(await NewBlock(client, $"B{i}", $"{9 + i:00}:00:00", $"{9 + i:00}:30:00"));

        var results = await Task.WhenAll(ids.Select(id => Start(client, id)));
        Assert.Equal(1, results.Count(r => r.StatusCode == HttpStatusCode.OK));
        Assert.All(results.Where(r => r.StatusCode != HttpStatusCode.OK), r => Assert.Equal(HttpStatusCode.Conflict, r.StatusCode));
        var blocks = await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-26&to=2026-11-26");
        Assert.Equal(1, blocks.EnumerateArray().Count(b => b.GetProperty("timerStartedAt").ValueKind != JsonValueKind.Null));
    }

    private async Task<(HttpClient Client, Guid Block, Guid Task)> PlannedTopTask(string title)
    {
        var (client, _) = await factory.NewUserAsync();
        await Json(await client.PostAsJsonAsync("/api/days/2026-11-26/plan", new
        {
            items = new[] { new { title, estimatedMinutes = 60, workMode = "DeepFocus", priority = "High", topRank = 1, start = "09:00:00", end = "10:00:00" } },
        }));
        var block = (await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-26&to=2026-11-26"))[0];
        return (client, block.GetProperty("id").GetGuid(), block.GetProperty("backlogTaskId").GetGuid());
    }

    private static async Task<(JsonElement Task, JsonElement Outcome)> State(HttpClient client, Guid taskId) => (
        (await client.GetFromJsonAsync<JsonElement>("/api/backlog")).EnumerateArray().Single(t => t.GetProperty("id").GetGuid() == taskId),
        (await client.GetFromJsonAsync<JsonElement>("/api/days/2026-11-26")).GetProperty("outcomes")[0]);

    [Fact]
    public async Task Stopping_as_finished_closes_the_block_the_task_and_the_top_three_outcome()
    {
        var (client, block, task) = await PlannedTopTask("Ship it");
        await Json(await Start(client, block));
        factory.Clock.Advance(TimeSpan.FromMinutes(50));
        var stopped = (await Json(await client.PostAsJsonAsync($"/api/blocks/{block}/timer/stop", new { outcome = "Finished" }))).GetProperty("block");
        Assert.Equal("Done", stopped.GetProperty("status").GetString());
        Assert.Equal(50, stopped.GetProperty("actualMinutes").GetInt32());
        Assert.Equal(-10, stopped.GetProperty("varianceMinutes").GetInt32());

        var (t, o) = await State(client, task);
        Assert.Equal("Done", t.GetProperty("status").GetString());
        Assert.Equal("Done", o.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Stopping_for_later_keeps_the_time_and_returns_the_task_to_the_backlog()
    {
        var (client, block, task) = await PlannedTopTask("Write chapter");
        await Json(await Start(client, block));
        factory.Clock.Advance(TimeSpan.FromMinutes(20));
        var stopped = (await Json(await client.PostAsJsonAsync($"/api/blocks/{block}/timer/stop", new { outcome = "Later" }))).GetProperty("block");
        Assert.Equal("Skipped", stopped.GetProperty("status").GetString());
        Assert.Equal(20, stopped.GetProperty("actualMinutes").GetInt32());

        var (t, o) = await State(client, task);
        Assert.Equal("InProgress", t.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, t.GetProperty("scheduledDate").ValueKind); // unscheduled again: shows in suggestions
        Assert.Equal(40, t.GetProperty("estimatedMinutes").GetInt32()); // what is left
        Assert.Equal("InProgress", o.GetProperty("status").GetString());
    }

    [Fact]
    public async Task Dropping_keeps_an_optional_note_and_drops_the_task()
    {
        var (client, block, task) = await PlannedTopTask("Redesign logo");
        await Json(await Start(client, block));
        var stopped = (await Json(await client.PostAsJsonAsync($"/api/blocks/{block}/timer/stop", new { outcome = "Drop", note = "Client cancelled the rebrand" }))).GetProperty("block");
        Assert.Equal("Skipped", stopped.GetProperty("status").GetString());
        Assert.Equal("Client cancelled the rebrand", stopped.GetProperty("stopNote").GetString());

        var (t, o) = await State(client, task);
        Assert.Equal("Skipped", t.GetProperty("status").GetString());
        Assert.Equal("Skipped", o.GetProperty("status").GetString());
        var tooLong = await client.PostAsJsonAsync($"/api/blocks/{block}/timer/stop", new { outcome = "Drop", note = new string('x', 600) });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
    }

    [Fact]
    public async Task Extending_adds_time_without_changing_the_plan()
    {
        var (client, _) = await factory.NewUserAsync();
        var id = await NewBlock(client);
        var extended = (await Json(await client.PostAsJsonAsync($"/api/blocks/{id}/timer/extend", new { minutes = 15 }))).GetProperty("block");
        Assert.Equal(15, extended.GetProperty("extendedMinutes").GetInt32());
        Assert.Equal(60, extended.GetProperty("plannedMinutes").GetInt32());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync($"/api/blocks/{id}/timer/extend", new { minutes = 7 })).StatusCode);
    }

    [Fact]
    public async Task Ticking_a_running_block_done_by_hand_stops_its_timer_and_keeps_the_time()
    {
        var (client, _) = await factory.NewUserAsync();
        var id = await NewBlock(client);
        await Json(await Start(client, id));
        factory.Clock.Advance(TimeSpan.FromMinutes(12));
        var version = (await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-26&to=2026-11-26"))[0].GetProperty("version").GetInt32();
        var done = await Json(await client.PatchAsJsonAsync($"/api/blocks/{id}/progress", new { status = "Done", version }));
        Assert.Equal(12, done.GetProperty("actualMinutes").GetInt32());
        Assert.Equal(HttpStatusCode.NoContent, (await client.GetAsync("/api/timer")).StatusCode);
    }

    [Fact]
    public async Task Nobody_can_run_someone_elses_timer()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();
        var id = await NewBlock(alice);
        Assert.Equal(HttpStatusCode.NotFound, (await Start(bob, id)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsync($"/api/blocks/{id}/timer/pause", null)).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PostAsJsonAsync($"/api/blocks/{id}/timer/stop", new { outcome = "Drop" })).StatusCode);
    }
}

public class FocusTimeTests
{
    [Theory]
    [InlineData(0, null)]
    [InlineData(29, null)]   // a misclick is not work
    [InlineData(30, 1)]      // real work is at least a minute
    [InlineData(89, 1)]
    [InlineData(90, 2)]
    [InlineData(1500, 25)]
    public void Actual_minutes_round_sensibly(int seconds, int? expected) => Assert.Equal(expected, Domain.FocusTime.ActualMinutes(seconds));

    [Fact]
    public void Elapsed_adds_the_running_period_to_what_was_banked()
    {
        var now = DateTimeOffset.UtcNow;
        Assert.Equal(600 + 120, Domain.FocusTime.Elapsed(600, now.AddMinutes(-2), now));
        Assert.Equal(600, Domain.FocusTime.Elapsed(600, null, now));
    }
}
