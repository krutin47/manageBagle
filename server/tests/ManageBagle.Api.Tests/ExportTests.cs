using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;

namespace ManageBagle.Api.Tests;

/// <summary>Handbook §17.3: a person can take all of their data with them, and only theirs.</summary>
public class ExportTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task The_export_holds_everything_the_account_owns_and_nothing_secret_or_belonging_to_others()
    {
        var (alice, aliceEmail) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();
        await alice.PostAsJsonAsync("/api/backlog/capture", new { items = new[] { new { title = "Alice secret plan", workMode = "ShallowWork", priority = "Low", impact = "High" } } });
        await alice.PostAsJsonAsync("/api/days/2026-11-26/plan", new { items = new[] { new { title = "Alice block", estimatedMinutes = 30, workMode = "ShallowWork", priority = "High", topRank = 1, start = "09:00:00", end = "09:30:00" } } });
        await alice.PutAsJsonAsync("/api/days/2026-11-26/review", new { biggestWin = "Shipped it", interruptions = "", changeTomorrow = "" });
        await alice.PostAsJsonAsync("/api/routines", new { title = "Lunch", days = "Everyday", start = "12:30:00", end = "13:15:00", taskPolicy = "NoTasks", isMeal = true });
        await bob.PostAsJsonAsync("/api/backlog/capture", new { items = new[] { new { title = "Bob diary", workMode = "ShallowWork", priority = "Low", impact = "Low" } } });

        var response = await alice.GetAsync("/api/account/export");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("attachment", response.Content.Headers.ContentDisposition?.DispositionType);
        var text = await response.Content.ReadAsStringAsync();
        var export = JsonDocument.Parse(text).RootElement;

        Assert.Equal(aliceEmail, export.GetProperty("profile").GetProperty("email").GetString());
        Assert.Contains("Alice secret plan", text);
        Assert.Contains("Alice block", text);
        Assert.Contains("Shipped it", text);
        Assert.Equal("Lunch", export.GetProperty("routines")[0].GetProperty("title").GetString());
        Assert.Equal(8, export.GetProperty("focusAreas").GetArrayLength());
        Assert.Equal(7, export.GetProperty("dayThemes").GetArrayLength());
        Assert.Equal(1, export.GetProperty("topThree").GetArrayLength());

        Assert.DoesNotContain("Bob diary", text);
        foreach (var secret in new[] { "passwordHash", "securityStamp", "concurrencyStamp", "urlProtected", "calendarFeedToken", "authenticatorKey", "recoveryCode" })
            Assert.DoesNotContain(secret, text, StringComparison.OrdinalIgnoreCase);

        // Exporting is recorded in the account's own activity.
        var activity = await alice.GetFromJsonAsync<JsonElement>("/api/auth/activity");
        Assert.Contains(activity.EnumerateArray(), e => e.GetProperty("event").GetString() == "data_exported");
    }

    [Fact]
    public async Task Nobody_can_export_without_signing_in()
    {
        var anonymous = factory.NewClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await anonymous.GetAsync("/api/account/export")).StatusCode);
    }
}

public class RetentionTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public async Task Activity_older_than_the_retention_period_is_removed_and_nothing_is_removed_when_it_is_off()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<ManageBagle.Api.Data.AppDbContext>();
        var (_, email) = await factory.NewUserAsync();
        var uid = db.Users.Single(u => u.Email == email).Id;
        var now = DateTimeOffset.UtcNow;
        db.AuditEvents.AddRange(
            new ManageBagle.Api.Data.AuditEvent { UserId = uid, Event = "old", At = now.AddMonths(-14) },
            new ManageBagle.Api.Data.AuditEvent { UserId = uid, Event = "recent", At = now.AddMonths(-2) });
        await db.SaveChangesAsync();

        Assert.Equal(0, await ManageBagle.Api.Infrastructure.RetentionService.PurgeAsync(db, 0, now, default)); // off: keeps everything
        Assert.Equal(1, await ManageBagle.Api.Infrastructure.RetentionService.PurgeAsync(db, 13, now, default));
        var left = db.AuditEvents.Where(e => e.UserId == uid).Select(e => e.Event).ToList();
        Assert.Contains("recent", left);
        Assert.DoesNotContain("old", left);
    }
}
