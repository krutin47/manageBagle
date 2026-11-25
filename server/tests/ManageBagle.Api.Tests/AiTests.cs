using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using ManageBagle.Api.Application.Ai;
using ManageBagle.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace ManageBagle.Api.Tests;

/// <summary>Stands in for Claude: returns what the test sets, and keeps what it was sent.</summary>
public sealed class FakeSuggestionModel : ITaskSuggestionModel
{
    public bool Configured => true;
    public ConcurrentQueue<(string Instructions, string Paragraph)> Calls { get; } = new();
    public Func<ModelReply> Reply { get; set; } = () => new ModelReply("{\"tasks\":[]}", "claude-opus-5-5", 500, 200, false);
    public Task<ModelReply> SuggestAsync(string instructions, string paragraph, CancellationToken ct)
    {
        Calls.Enqueue((instructions, paragraph));
        return Task.FromResult(Reply());
    }
}

public sealed class AiFactory : ApiFactory
{
    public FakeSuggestionModel Model { get; } = new();
    protected override IEnumerable<(string Key, string Value)> ExtraSettings => [("Ai:DailyLimitPerUser", "3"), ("RateLimits:CalendarFetchPerMinute", "1000")];
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services => services.AddSingleton<ITaskSuggestionModel>(Model));
    }
}

/// <summary>ADR-020: suggestions only, checked like any input, and spend capped.</summary>
public class AiTests(AiFactory factory) : IClassFixture<AiFactory>
{
    private static Task<HttpResponseMessage> Suggest(HttpClient c, string text) => c.PostAsJsonAsync("/api/ai/suggest-tasks", new { text });

    [Fact]
    public async Task A_paragraph_becomes_checked_suggestions_and_nothing_is_saved()
    {
        var (client, email) = await factory.NewUserAsync();
        factory.Model.Reply = () => new ModelReply("""
            {"tasks":[
              {"title":"Book the dentist","estimated_minutes":17,"kind":"Personal","focus_area":"home / admin","impact":"Low","due_date":"2026-12-04","outside":true},
              {"title":"  ","estimated_minutes":null,"kind":"ShallowWork","focus_area":null,"impact":"Medium","due_date":null,"outside":false},
              {"title":"Finish the deck","estimated_minutes":5000,"kind":"NotAKind","focus_area":"Somebody else's area","impact":"Huge","due_date":"next week","outside":false},
              {"title":"Call mum","estimated_minutes":null,"kind":"Personal","focus_area":null,"impact":"Medium","due_date":null,"outside":false},
              {"title":"Odd lengths","estimated_minutes":"an hour","kind":"ShallowWork","focus_area":null,"impact":"Low","due_date":null,"outside":"yes"}
            ]}
            """, "claude-opus-5-5", 800, 300, false);

        var r = await Suggest(client, "Book the dentist sometime next Friday, and I really need to finish the deck.");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var tasks = (await r.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("tasks").EnumerateArray().ToArray();
        Assert.Equal(4, tasks.Length); // the blank one is dropped

        var dentist = tasks[0];
        Assert.Equal(15, dentist.GetProperty("estimatedMinutes").GetInt32()); // rounded to 5 minutes
        Assert.Equal("Personal", dentist.GetProperty("workMode").GetString());
        Assert.NotEqual(JsonValueKind.Null, dentist.GetProperty("focusAreaId").ValueKind); // matched by name, case-insensitively
        Assert.Equal("2026-12-04", dentist.GetProperty("dueDate").GetString());
        Assert.True(dentist.GetProperty("isOutside").GetBoolean());

        var deck = tasks[1];
        Assert.Equal(1440, deck.GetProperty("estimatedMinutes").GetInt32()); // clamped
        Assert.Equal("ShallowWork", deck.GetProperty("workMode").GetString()); // unknown kind → default
        Assert.Equal(JsonValueKind.Null, deck.GetProperty("focusAreaId").ValueKind); // unknown area → none
        Assert.Equal("Medium", deck.GetProperty("impact").GetString());
        Assert.Equal(JsonValueKind.Null, deck.GetProperty("dueDate").ValueKind);

        Assert.Equal(JsonValueKind.Null, tasks[2].GetProperty("estimatedMinutes").ValueKind); // null means "not said", not a crash
        Assert.Equal(JsonValueKind.Null, tasks[3].GetProperty("estimatedMinutes").ValueKind); // wrong type: ignored
        Assert.False(tasks[3].GetProperty("isOutside").GetBoolean());

        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/backlog")).GetArrayLength()); // suggestions only

        var (instructions, paragraph) = factory.Model.Calls.Last();
        Assert.Contains("Home / Admin", instructions); // the person's focus areas, so the model can use them
        Assert.Contains(DateTime.UtcNow.Year.ToString(), instructions); // today's date, to resolve "Friday"
        Assert.DoesNotContain(email, instructions + paragraph); // nothing about the person but their areas
    }

    [Fact]
    public async Task Each_person_has_a_daily_limit()
    {
        var (client, _) = await factory.NewUserAsync();
        factory.Model.Reply = () => new ModelReply("{\"tasks\":[]}", "claude-opus-5-5", 500, 200, false);
        for (var i = 0; i < 3; i++) Assert.Equal(HttpStatusCode.OK, (await Suggest(client, $"Something {i}")).StatusCode);
        var fourth = await Suggest(client, "One more");
        Assert.Equal(HttpStatusCode.TooManyRequests, fourth.StatusCode);
        Assert.Contains("ai_daily_limit", await fourth.Content.ReadAsStringAsync());
        Assert.Equal(0, (await client.GetFromJsonAsync<JsonElement>("/api/ai/status")).GetProperty("remainingToday").GetInt32());
    }

    [Fact]
    public async Task A_refusal_is_explained_and_still_counted()
    {
        var (client, _) = await factory.NewUserAsync();
        factory.Model.Reply = () => new ModelReply("", "claude-opus-5-5", 400, 10, true);
        var r = await Suggest(client, "Text the model declines");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
        Assert.Contains("ai_declined", await r.Content.ReadAsStringAsync());
        Assert.Equal(2, (await client.GetFromJsonAsync<JsonElement>("/api/ai/status")).GetProperty("remainingToday").GetInt32());
    }

    [Fact]
    public async Task Empty_or_very_long_text_is_refused_before_anything_is_sent()
    {
        var (client, _) = await factory.NewUserAsync();
        var before = factory.Model.Calls.Count;
        Assert.Equal(HttpStatusCode.BadRequest, (await Suggest(client, "   ")).StatusCode);
        Assert.Equal(HttpStatusCode.BadRequest, (await Suggest(client, new string('x', SuggestTasks.MaxLength + 1))).StatusCode);
        Assert.Equal(before, factory.Model.Calls.Count);
    }

    // The budget is shared by everyone, so this test uses its own app and database.
    [Fact]
    public async Task The_monthly_budget_pauses_the_feature_for_everyone()
    {
        var own = new AiFactory();
        try
        {
        var (alice, _) = await own.NewUserAsync();
        var (bob, _) = await own.NewUserAsync();
        // One very expensive call: 600,000 output tokens at $20 per million is $12, over the $10 budget.
        own.Model.Reply = () => new ModelReply("{\"tasks\":[]}", "claude-opus-5-5", 1000, 600_000, false);
        Assert.Equal(HttpStatusCode.OK, (await Suggest(alice, "Expensive")).StatusCode);

        var blocked = await Suggest(bob, "Anything");
        Assert.Equal(HttpStatusCode.ServiceUnavailable, blocked.StatusCode);
        Assert.Contains("ai_budget_reached", await blocked.Content.ReadAsStringAsync());
        Assert.False((await bob.GetFromJsonAsync<JsonElement>("/api/ai/status")).GetProperty("enabled").GetBoolean());

        await using var scope = own.Services.CreateAsyncScope();
        var spent = scope.ServiceProvider.GetRequiredService<AppDbContext>().AiUsage.Sum(u => u.CostUsd);
        Assert.Equal(12.004m, spent); // $0.004 input + $12 output
        }
        finally
        {
            await own.DisposeAsync(); // drops this test's own database
        }
    }
}

public class AiOffTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Without_an_API_key_the_feature_is_off_and_says_so()
    {
        var (client, _) = await factory.NewUserAsync();
        Assert.False((await client.GetFromJsonAsync<JsonElement>("/api/ai/status")).GetProperty("enabled").GetBoolean());
        var r = await client.PostAsJsonAsync("/api/ai/suggest-tasks", new { text = "Buy milk" });
        Assert.Equal(HttpStatusCode.ServiceUnavailable, r.StatusCode);
        Assert.Contains("ai_off", await r.Content.ReadAsStringAsync());
    }
}
