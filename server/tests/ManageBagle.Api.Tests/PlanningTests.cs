using System.Net;
using System.Net.Http.Json;
using System.Text.Json;

namespace ManageBagle.Api.Tests;

[Collection("api")]
public class PlanningTests(ApiFactory factory)
{
    private static object Block(string title = "Write acceptance test", string start = "09:00:00", string end = "10:30:00",
        string date = "2026-11-16", Guid? area = null, string status = "Planned", int? actual = null) => new
    {
        date, start, end, title, focusAreaId = area, priority = "High", workMode = "DeepFocus", status, actualMinutes = actual, notes = "",
    };

    private static async Task<JsonElement> Json(HttpResponseMessage response)
    {
        Assert.True(response.IsSuccessStatusCode, $"{(int)response.StatusCode}: {await response.Content.ReadAsStringAsync()}");
        return await response.Content.ReadFromJsonAsync<JsonElement>();
    }

    [Fact]
    public async Task Block_lifecycle_plan_log_and_variance()
    {
        var (client, _) = await factory.NewUserAsync();

        var created = await Json(await client.PostAsJsonAsync("/api/blocks", Block()));
        var id = created.GetProperty("id").GetGuid();
        Assert.Equal(90, created.GetProperty("plannedMinutes").GetInt32());
        Assert.Equal(JsonValueKind.Null, created.GetProperty("actualMinutes").ValueKind);
        Assert.Equal(JsonValueKind.Null, created.GetProperty("varianceMinutes").ValueKind);

        var logged = await Json(await client.PatchAsJsonAsync($"/api/blocks/{id}/progress", new { status = "Done", actualMinutes = 105 }));
        Assert.Equal("Done", logged.GetProperty("status").GetString());
        Assert.Equal(15, logged.GetProperty("varianceMinutes").GetInt32());

        var week = await client.GetFromJsonAsync<JsonElement>("/api/summary/week?start=2026-11-16");
        Assert.Equal(90, week.GetProperty("totals").GetProperty("plannedMinutes").GetInt32());
        Assert.Equal(105, week.GetProperty("totals").GetProperty("loggedMinutes").GetInt32());
        Assert.Equal(1, week.GetProperty("totals").GetProperty("doneRate").GetDouble());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/blocks/{id}")).StatusCode);
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-16&to=2026-11-22")).GetArrayLength());
    }

    [Theory]
    [InlineData("09:03:00", "10:00:00", "Title")] // not a 5-minute step
    [InlineData("09:00:00", "09:00:00", "Title")] // zero length
    [InlineData("09:00:00", "10:00:00", "")]      // nothing to do
    public async Task Invalid_blocks_are_refused(string start, string end, string title)
    {
        var (client, _) = await factory.NewUserAsync();
        var response = await client.PostAsJsonAsync("/api/blocks", Block(title, start, end));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task One_users_data_is_invisible_and_untouchable_to_another()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();

        var aliceArea = (await alice.GetFromJsonAsync<JsonElement>("/api/areas"))[0].GetProperty("id").GetGuid();
        var block = await Json(await alice.PostAsJsonAsync("/api/blocks", Block(area: aliceArea)));
        var id = block.GetProperty("id").GetGuid();

        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-16&to=2026-11-22")).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PutAsJsonAsync($"/api/blocks/{id}", Block("hijacked"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PatchAsJsonAsync($"/api/blocks/{id}/progress", new { status = "Done" })).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/blocks/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/areas/{aliceArea}")).StatusCode);

        // Bob cannot attach his own block to Alice's focus area either.
        Assert.Equal(HttpStatusCode.BadRequest, (await bob.PostAsJsonAsync("/api/blocks", Block(area: aliceArea))).StatusCode);

        var still = await alice.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-16&to=2026-11-22");
        Assert.Equal("Write acceptance test", still[0].GetProperty("title").GetString());
    }

    [Fact]
    public async Task Deleting_a_focus_area_keeps_its_blocks_as_unassigned()
    {
        var (client, _) = await factory.NewUserAsync();
        var area = await Json(await client.PostAsJsonAsync("/api/areas", new { name = "Side project", color = "violet" }));
        var areaId = area.GetProperty("id").GetGuid();
        await Json(await client.PostAsJsonAsync("/api/blocks", Block(area: areaId)));

        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/areas", new { name = "X", color = "neon" })).StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"/api/areas/{areaId}")).StatusCode);

        var blocks = await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-16&to=2026-11-16");
        Assert.Equal(1, blocks.GetArrayLength());
        Assert.Equal(JsonValueKind.Null, blocks[0].GetProperty("focusAreaId").ValueKind);
    }

    [Fact]
    public async Task Backlog_task_can_be_scheduled_and_finishing_the_block_finishes_the_task()
    {
        var (client, _) = await factory.NewUserAsync();
        var task = await Json(await client.PostAsJsonAsync("/api/backlog", new
        {
            title = "Compare supplier quotes", estimatedMinutes = 30, priority = "High", status = "Planned", nextStep = "Open the three PDFs",
        }));
        var taskId = task.GetProperty("id").GetGuid();

        var scheduled = await Json(await client.PostAsJsonAsync($"/api/backlog/{taskId}/schedule",
            new { date = "2026-11-18", start = "19:00:00", end = "19:30:00", workMode = "Personal" }));
        Assert.Equal("2026-11-18", scheduled.GetProperty("task").GetProperty("scheduledDate").GetString());
        var blockId = scheduled.GetProperty("block").GetProperty("id").GetGuid();
        Assert.Equal("Compare supplier quotes", scheduled.GetProperty("block").GetProperty("title").GetString());

        await Json(await client.PatchAsJsonAsync($"/api/blocks/{blockId}/progress", new { status = "Done", actualMinutes = 25 }));
        var tasks = await client.GetFromJsonAsync<JsonElement>("/api/backlog");
        Assert.Equal("Done", tasks[0].GetProperty("status").GetString());
    }

    [Fact]
    public async Task Daily_focus_holds_three_ranked_outcomes_and_a_review()
    {
        var (client, _) = await factory.NewUserAsync();
        const string day = "/api/days/2026-11-16";

        await Json(await client.PutAsJsonAsync($"{day}/outcomes/2", new { result = "Tailor CV to 2 roles", status = "Planned", minutesNeeded = 60 }));
        await Json(await client.PutAsJsonAsync($"{day}/outcomes/1", new { result = "Ship optimizer endpoint", status = "InProgress", minutesNeeded = 90 }));
        await Json(await client.PutAsJsonAsync($"{day}/outcomes/1", new { result = "Ship and test optimizer endpoint", status = "Done" }));
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync($"{day}/outcomes/4", new { result = "A fourth", status = "Planned" })).StatusCode);

        await Json(await client.PutAsJsonAsync($"{day}/review", new { biggestWin = "Endpoint shipped", interruptions = "Slack", changeTomorrow = "Phone in another room" }));

        var loaded = await client.GetFromJsonAsync<JsonElement>(day);
        var outcomes = loaded.GetProperty("outcomes");
        Assert.Equal(2, outcomes.GetArrayLength());
        Assert.Equal("Ship and test optimizer endpoint", outcomes[0].GetProperty("result").GetString());
        Assert.Equal("Endpoint shipped", loaded.GetProperty("review").GetProperty("biggestWin").GetString());

        Assert.Equal(HttpStatusCode.NoContent, (await client.DeleteAsync($"{day}/outcomes/2")).StatusCode);
        Assert.Equal(1, (await client.GetFromJsonAsync<JsonElement>(day)).GetProperty("outcomes").GetArrayLength());
    }

    [Fact]
    public async Task Day_themes_can_be_edited()
    {
        var (client, _) = await factory.NewUserAsync();
        await Json(await client.PutAsJsonAsync("/api/themes/Monday", new { primaryFocus = "Shipping day", outcome = "One release", review = "" }));
        var themes = await client.GetFromJsonAsync<JsonElement>("/api/themes");
        Assert.Equal("Monday", themes[0].GetProperty("day").GetString());
        Assert.Equal("Shipping day", themes[0].GetProperty("primaryFocus").GetString());
        Assert.Equal("Sunday", themes[6].GetProperty("day").GetString());
    }

    [Fact]
    public async Task Plan_my_day_captures_tasks_books_them_and_names_the_top_three()
    {
        var (client, _) = await factory.NewUserAsync();
        const string day = "2026-11-18";
        var existing = await Json(await client.PostAsJsonAsync("/api/backlog", new { title = "Renew passport", priority = "Low", status = "Planned" }));

        var plan = await Json(await client.PostAsJsonAsync($"/api/days/{day}/plan", new
        {
            items = new object[]
            {
                new { title = "Ship the importer", estimatedMinutes = 90, workMode = "DeepFocus", priority = "Medium", impact = "High", dueDate = "2026-11-20", topRank = 1, start = "09:00:00", end = "10:30:00" },
                new { taskId = existing.GetProperty("id").GetGuid(), title = "Renew passport", estimatedMinutes = 40, workMode = "Personal", isOutside = true, priority = "Low", topRank = 2, start = "10:35:00", end = "11:25:00" },
                new { title = "Sort the garage", estimatedMinutes = 120, workMode = "Personal", priority = "Low" },
            },
        }));
        Assert.Equal(2, plan.GetProperty("tasksCreated").GetInt32());
        Assert.Equal(2, plan.GetProperty("blocksBooked").GetInt32());
        Assert.Equal(1, plan.GetProperty("leftInBacklog").GetInt32());

        var blocks = await client.GetFromJsonAsync<JsonElement>($"/api/blocks?from={day}&to={day}");
        Assert.Equal(2, blocks.GetArrayLength());
        Assert.True(blocks[1].GetProperty("isOutside").GetBoolean());
        Assert.Equal(50, blocks[1].GetProperty("plannedMinutes").GetInt32()); // 40 estimated + the buffer the client added

        var tasks = await client.GetFromJsonAsync<JsonElement>("/api/backlog");
        Assert.Equal(3, tasks.GetArrayLength()); // the existing task was reused, not duplicated
        var shipped = tasks.EnumerateArray().Single(t => t.GetProperty("title").GetString() == "Ship the importer");
        Assert.Equal("High", shipped.GetProperty("impact").GetString());
        Assert.Equal("2026-11-20", shipped.GetProperty("dueDate").GetString());
        var garage = tasks.EnumerateArray().Single(t => t.GetProperty("title").GetString() == "Sort the garage");
        Assert.Equal("Medium", garage.GetProperty("impact").GetString());
        Assert.Equal(JsonValueKind.Null, garage.GetProperty("scheduledDate").ValueKind);

        var outcomes = (await client.GetFromJsonAsync<JsonElement>($"/api/days/{day}")).GetProperty("outcomes");
        Assert.Equal("Ship the importer", outcomes[0].GetProperty("result").GetString());
        Assert.Equal("Renew passport", outcomes[1].GetProperty("result").GetString());

        // One tick finishes all three views of the same piece of work: block, top-three outcome, task.
        var importer = blocks[0].GetProperty("id").GetGuid();
        await Json(await client.PatchAsJsonAsync($"/api/blocks/{importer}/progress", new { status = "Done", actualMinutes = 80 }));
        outcomes = (await client.GetFromJsonAsync<JsonElement>($"/api/days/{day}")).GetProperty("outcomes");
        Assert.Equal("Done", outcomes[0].GetProperty("status").GetString());

        // …and the other way round: ticking the outcome finishes its block and task.
        await Json(await client.PutAsJsonAsync($"/api/days/{day}/outcomes/2", new { result = "Renew passport", status = "Done" }));
        blocks = await client.GetFromJsonAsync<JsonElement>($"/api/blocks?from={day}&to={day}");
        Assert.Equal("Done", blocks[1].GetProperty("status").GetString());
        Assert.Equal(50, blocks[1].GetProperty("actualMinutes").GetInt32());
        tasks = await client.GetFromJsonAsync<JsonElement>("/api/backlog");
        Assert.Equal(2, tasks.EnumerateArray().Count(t => t.GetProperty("status").GetString() == "Done"));
    }

    [Fact]
    public async Task A_plan_is_all_or_nothing_and_cannot_touch_another_users_tasks()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();
        var aliceTask = (await Json(await alice.PostAsJsonAsync("/api/backlog", new { title = "Private", priority = "Low", status = "Planned" }))).GetProperty("id").GetGuid();

        var stolen = await bob.PostAsJsonAsync("/api/days/2026-11-18/plan", new
        {
            items = new object[]
            {
                new { title = "Fine", estimatedMinutes = 30, workMode = "DeepFocus", priority = "Low", start = "09:00:00", end = "09:30:00" },
                new { taskId = aliceTask, title = "Renamed by Bob", estimatedMinutes = 30, workMode = "DeepFocus", priority = "Low" },
            },
        });
        Assert.Equal(HttpStatusCode.BadRequest, stolen.StatusCode);
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/api/backlog")).GetArrayLength());
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-18&to=2026-11-18")).GetArrayLength());
        Assert.Equal("Private", (await alice.GetFromJsonAsync<JsonElement>("/api/backlog"))[0].GetProperty("title").GetString());

        var twoFirsts = await bob.PostAsJsonAsync("/api/days/2026-11-18/plan", new
        {
            items = new object[]
            {
                new { title = "A", estimatedMinutes = 30, workMode = "DeepFocus", priority = "Low", topRank = 1 },
                new { title = "B", estimatedMinutes = 30, workMode = "DeepFocus", priority = "Low", topRank = 1 },
            },
        });
        Assert.Equal(HttpStatusCode.BadRequest, twoFirsts.StatusCode);
    }
}
