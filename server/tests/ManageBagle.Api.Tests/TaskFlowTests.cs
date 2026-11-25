using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ManageBagle.Api.Tests;

/// <summary>P2-E1 (brain dump only captures) and P2-G1 (the board follows Today), through the API.</summary>
public class TaskFlowTests(ClockedFactory factory) : IClassFixture<ClockedFactory>
{
    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static object Line(string title, Guid? focusAreaId = null) => new
    {
        title, estimatedMinutes = 30, focusAreaId, workMode = "ShallowWork", isOutside = false, priority = "Low", impact = "High", dueDate = "2026-11-27", breakMinutes = 5,
    };

    [Fact]
    public async Task A_brain_dump_saves_every_line_to_the_backlog_and_books_nothing()
    {
        var (client, _) = await factory.NewUserAsync();
        var saved = await Json(await client.PostAsJsonAsync("/api/backlog/capture", new { items = new[] { Line("Call the bank"), Line("Renew passport") } }));
        Assert.Equal(2, saved.GetArrayLength());
        Assert.All(saved.EnumerateArray(), t =>
        {
            Assert.Equal("Planned", t.GetProperty("status").GetString());
            Assert.Equal(JsonValueKind.Null, t.GetProperty("scheduledDate").ValueKind);
            Assert.Equal("High", t.GetProperty("impact").GetString());
            Assert.Equal(5, t.GetProperty("breakMinutes").GetInt32());
        });
        Assert.Equal(2, (await client.GetFromJsonAsync<JsonElement>("/api/backlog")).GetArrayLength());
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-01&to=2026-12-31")).GetArrayLength());
    }

    [Fact]
    public async Task A_brain_dump_saves_all_or_nothing_and_cannot_use_another_persons_focus_area()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();
        var aliceArea = (await Json(await alice.PostAsJsonAsync("/api/areas", new { name = "Build", color = "teal" }))).GetProperty("id").GetGuid();

        var r = await bob.PostAsJsonAsync("/api/backlog/capture", new { items = new[] { Line("Fine"), Line("Sneaky", aliceArea) } });
        Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/api/backlog")).GetArrayLength());

        var blank = await bob.PostAsJsonAsync("/api/backlog/capture", new { items = new[] { Line("Fine"), Line("") } });
        Assert.Equal(HttpStatusCode.BadRequest, blank.StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await bob.PostAsJsonAsync("/api/backlog/capture", new { items = Array.Empty<object>() })).StatusCode);
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/api/backlog")).GetArrayLength());
    }

    private async Task<(HttpClient Client, JsonElement Block, Guid Task)> PlannedTask(string title)
    {
        var (client, _) = await factory.NewUserAsync();
        await Json(await client.PostAsJsonAsync("/api/days/2026-11-26/plan", new
        {
            items = new[] { new { title, estimatedMinutes = 60, workMode = "DeepFocus", priority = "High", topRank = 1, start = "09:00:00", end = "10:00:00" } },
        }));
        var block = (await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-26&to=2026-11-26"))[0];
        return (client, block, block.GetProperty("backlogTaskId").GetGuid());
    }

    private static async Task<JsonElement> Task(HttpClient client, Guid id) =>
        (await client.GetFromJsonAsync<JsonElement>("/api/backlog")).EnumerateArray().Single(t => t.GetProperty("id").GetGuid() == id);

    [Fact]
    public async Task Starting_the_timer_moves_the_card_to_in_progress()
    {
        var (client, block, task) = await PlannedTask("Draft proposal");
        await Json(await client.PostAsJsonAsync($"/api/blocks/{block.GetProperty("id").GetGuid()}/timer/start", new { pauseRunning = false }));
        Assert.Equal("InProgress", (await Task(client, task)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Setting_a_block_in_progress_by_hand_moves_the_card_too()
    {
        var (client, block, task) = await PlannedTask("Tidy inbox");
        await Json(await client.PatchAsJsonAsync($"/api/blocks/{block.GetProperty("id").GetGuid()}/progress", new { status = "InProgress", version = block.GetProperty("version").GetInt32() }));
        Assert.Equal("InProgress", (await Task(client, task)).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Skipping_a_block_on_today_puts_the_card_back_in_to_do_unscheduled()
    {
        var (client, block, task) = await PlannedTask("Clean garage");
        Assert.NotEqual(JsonValueKind.Null, (await Task(client, task)).GetProperty("scheduledDate").ValueKind);
        await Json(await client.PatchAsJsonAsync($"/api/blocks/{block.GetProperty("id").GetGuid()}/progress", new { status = "Skipped", version = block.GetProperty("version").GetInt32() }));
        var t = await Task(client, task);
        Assert.Equal("Planned", t.GetProperty("status").GetString());
        Assert.Equal(JsonValueKind.Null, t.GetProperty("scheduledDate").ValueKind);
    }

    [Fact]
    public async Task Reopening_a_finished_block_reopens_the_card()
    {
        var (client, block, task) = await PlannedTask("Send invoice");
        var id = block.GetProperty("id").GetGuid();
        var done = await Json(await client.PatchAsJsonAsync($"/api/blocks/{id}/progress", new { status = "Done", version = block.GetProperty("version").GetInt32() }));
        Assert.Equal("Done", (await Task(client, task)).GetProperty("status").GetString());
        await Json(await client.PatchAsJsonAsync($"/api/blocks/{id}/progress", new { status = "Planned", version = done.GetProperty("version").GetInt32() }));
        Assert.Equal("Planned", (await Task(client, task)).GetProperty("status").GetString());
    }
}
