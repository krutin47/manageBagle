using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ManageBagle.Api.Domain;

namespace ManageBagle.Api.Tests;

public class RoutineScheduleTests
{
    private static readonly TimeZoneInfo Halifax = TimeZoneInfo.FindSystemTimeZoneById("America/Halifax");
    private static RoutineRule Rule(string title, Weekdays days, string start, string end, TaskPolicy policy = TaskPolicy.NoTasks) =>
        new(Guid.NewGuid(), title, days, TimeOnly.Parse(start), TimeOnly.Parse(end), policy, [], false);

    [Fact]
    public void A_weekday_routine_repeats_only_on_its_days()
    {
        var lunch = Rule("Lunch", Weekdays.Workdays, "12:30", "13:15");
        var week = RoutineSchedule.Expand([lunch], new DateOnly(2026, 11, 23), new DateOnly(2026, 11, 29), Halifax); // Mon–Sun
        Assert.Equal(5, week.Count);
        Assert.All(week, o => Assert.Equal(45, o.Minutes));
        Assert.DoesNotContain(week, o => o.Date.DayOfWeek is DayOfWeek.Saturday or DayOfWeek.Sunday);
    }

    [Fact]
    public void A_routine_keeps_its_clock_time_across_a_daylight_saving_change()
    {
        var standup = Rule("Stand-up", Weekdays.Everyday, "09:00", "09:15");
        var days = RoutineSchedule.Expand([standup], new DateOnly(2026, 3, 7), new DateOnly(2026, 3, 9), Halifax);
        Assert.All(days, o => Assert.Equal(new TimeOnly(9, 0), o.Start)); // 09:00 on the clock, not 168 elapsed hours
    }

    [Fact]
    public void A_start_inside_the_spring_forward_gap_moves_to_the_next_real_time()
    {
        var early = Rule("Early run", Weekdays.Sunday, "02:30", "03:30");
        var o = Assert.Single(RoutineSchedule.Expand([early], new DateOnly(2026, 3, 8), new DateOnly(2026, 3, 8), Halifax));
        Assert.Equal(new TimeOnly(3, 0), o.Start);
        Assert.Equal(30, o.Minutes);
    }

    [Fact]
    public void An_overnight_routine_ends_the_next_morning()
    {
        var sleep = Rule("Sleep", Weekdays.Everyday, "23:00", "07:00");
        var o = Assert.Single(RoutineSchedule.Expand([sleep], new DateOnly(2026, 11, 25), new DateOnly(2026, 11, 25), Halifax));
        Assert.Equal(480, o.Minutes);
        Assert.Equal((23 * 60, 31 * 60), RoutineSchedule.Span(o));
    }

    [Fact]
    public void Task_policies_decide_what_may_go_inside()
    {
        var build = Guid.NewGuid();
        RoutineOccurrence Occ(TaskPolicy p, params Guid[] areas) => new(Guid.NewGuid(), "R", new DateOnly(2026, 11, 25), new TimeOnly(9, 0), new TimeOnly(17, 0), 480, p, areas, false);
        Assert.False(Occ(TaskPolicy.NoTasks).Accepts(build));
        Assert.True(Occ(TaskPolicy.AnyTask).Accepts(null));
        Assert.True(Occ(TaskPolicy.SelectedAreas, build).Accepts(build));
        Assert.False(Occ(TaskPolicy.SelectedAreas, build).Accepts(Guid.NewGuid()));
        Assert.False(Occ(TaskPolicy.SelectedAreas, build).Accepts(null));
    }
}

[Collection("api")]
public class RoutineTests(ApiFactory factory)
{
    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        return await r.Content.ReadFromJsonAsync<JsonElement>();
    }

    private static object Routine(string title, string start, string end, string policy = "NoTasks", Guid[]? areaIds = null, string days = "Workdays", bool isMeal = false) =>
        new { title, days, start, end, taskPolicy = policy, areaIds, isMeal };

    private static object PlanAt(string title, string start, string end, Guid? area = null) => new
    {
        items = new[] { new { title, estimatedMinutes = 30, focusAreaId = area, workMode = "ShallowWork", priority = "Low", start, end, breakAfterMinutes = 10 } },
    };

    [Fact]
    public async Task Routines_are_created_validated_and_listed_as_commitments()
    {
        var (client, _) = await factory.NewUserAsync(timeZone: "America/Halifax");
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/routines", Routine("Nothing", "09:00:00", "10:00:00", days: "None"))).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PostAsJsonAsync("/api/routines", Routine("Work", "09:00:00", "17:00:00", "SelectedAreas"))).StatusCode);

        await Json(await client.PostAsJsonAsync("/api/routines", Routine("Lunch", "12:30:00", "13:15:00", isMeal: true)));
        var week = await client.GetFromJsonAsync<JsonElement>("/api/commitments?from=2026-11-23&to=2026-11-29");
        Assert.Equal(5, week.GetArrayLength());
        Assert.True(week[0].GetProperty("isMeal").GetBoolean());
        Assert.Equal("routine", week[0].GetProperty("kind").GetString());
    }

    [Fact]
    public async Task Planning_respects_what_each_routine_accepts()
    {
        var (client, _) = await factory.NewUserAsync();
        var areas = await client.GetFromJsonAsync<JsonElement>("/api/areas");
        var build = areas[0].GetProperty("id").GetGuid();
        var home = areas[5].GetProperty("id").GetGuid();
        await Json(await client.PostAsJsonAsync("/api/routines", Routine("Lunch", "12:30:00", "13:15:00")));
        await Json(await client.PostAsJsonAsync("/api/routines", Routine("Work hours", "09:00:00", "12:30:00", "SelectedAreas", [build])));
        await Json(await client.PostAsJsonAsync("/api/routines", Routine("Evening", "18:00:00", "20:00:00", "AnyTask")));
        const string wednesday = "/api/days/2026-11-25/plan";

        var lunch = await client.PostAsJsonAsync(wednesday, PlanAt("Email", "12:45:00", "13:15:00"));
        Assert.Equal(HttpStatusCode.Conflict, lunch.StatusCode);
        var problem = await lunch.Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("routine_conflict", problem.GetProperty("code").GetString());
        Assert.Contains("Lunch", problem.GetProperty("detail").GetString());

        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync(wednesday, PlanAt("Bills", "10:00:00", "10:30:00", home))).StatusCode);
        await Json(await client.PostAsJsonAsync(wednesday, PlanAt("Ship it", "10:00:00", "10:30:00", build)));
        await Json(await client.PostAsJsonAsync(wednesday, PlanAt("Groceries", "18:30:00", "19:00:00", home)));
        // Saturday has no weekday routines, so the same time is free.
        await Json(await client.PostAsJsonAsync("/api/days/2026-11-28/plan", PlanAt("Email", "12:45:00", "13:15:00")));

        // The recovery break travels with the block.
        var blocks = await client.GetFromJsonAsync<JsonElement>("/api/blocks?from=2026-11-25&to=2026-11-25");
        Assert.All(blocks.EnumerateArray(), b => Assert.Equal(10, b.GetProperty("breakAfterMinutes").GetInt32()));
    }

    [Fact]
    public async Task An_overnight_routine_from_the_night_before_protects_the_early_morning()
    {
        var (client, _) = await factory.NewUserAsync();
        await Json(await client.PostAsJsonAsync("/api/routines", Routine("Sleep", "23:00:00", "07:00:00", days: "Everyday")));
        Assert.Equal(HttpStatusCode.Conflict, (await client.PostAsJsonAsync("/api/days/2026-11-25/plan", PlanAt("Early email", "06:00:00", "06:30:00"))).StatusCode);
        await Json(await client.PostAsJsonAsync("/api/days/2026-11-25/plan", PlanAt("Email", "07:00:00", "07:30:00")));
    }

    [Fact]
    public async Task Breaks_and_the_day_window_are_saved()
    {
        var (client, _) = await factory.NewUserAsync();
        var prefs = await client.GetFromJsonAsync<JsonElement>("/api/preferences");
        Assert.Equal("08:00:00", prefs.GetProperty("dayStart").GetString());
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/preferences", new { dayStart = "20:00:00", dayEnd = "08:00:00" })).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await client.PutAsJsonAsync("/api/preferences", new { dayStart = "08:00:00", dayEnd = "20:00:00", waterReminderMinutes = 7 })).StatusCode);
        await Json(await client.PutAsJsonAsync("/api/preferences", new { dayStart = "07:30:00", dayEnd = "22:00:00", waterReminderMinutes = 60 }));
        Assert.Equal(60, (await client.GetFromJsonAsync<JsonElement>("/api/preferences")).GetProperty("waterReminderMinutes").GetInt32());

        var area = (await client.GetFromJsonAsync<JsonElement>("/api/areas"))[0];
        await Json(await client.PutAsJsonAsync($"/api/areas/{area.GetProperty("id").GetGuid()}", new { name = area.GetProperty("name").GetString(), color = "teal", breakMinutes = 15, breakPlacement = "Before" }));
        var saved = (await client.GetFromJsonAsync<JsonElement>("/api/areas"))[0];
        Assert.Equal(15, saved.GetProperty("breakMinutes").GetInt32());
        Assert.Equal("Before", saved.GetProperty("breakPlacement").GetString());
    }

    [Fact]
    public async Task Routines_belong_to_their_owner()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();
        var aliceArea = (await alice.GetFromJsonAsync<JsonElement>("/api/areas"))[0].GetProperty("id").GetGuid();
        var routine = await Json(await alice.PostAsJsonAsync("/api/routines", Routine("Lunch", "12:30:00", "13:15:00")));
        var id = routine.GetProperty("id").GetGuid();

        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/api/routines")).GetArrayLength());
        Assert.Equal(0, (await bob.GetFromJsonAsync<JsonElement>("/api/commitments?from=2026-11-23&to=2026-11-29")).GetArrayLength());
        Assert.Equal(HttpStatusCode.NotFound, (await bob.PutAsJsonAsync($"/api/routines/{id}", Routine("Hijack", "01:00:00", "02:00:00"))).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await bob.DeleteAsync($"/api/routines/{id}")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await bob.PostAsJsonAsync("/api/routines", Routine("Work", "09:00:00", "17:00:00", "SelectedAreas", [aliceArea]))).StatusCode);
    }
}
