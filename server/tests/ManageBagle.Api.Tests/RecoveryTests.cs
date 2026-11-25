using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using OtpNet;

namespace ManageBagle.Api.Tests;

/// <summary>Same app, but a lost-second-factor reset becomes available immediately after confirmation.</summary>
public sealed class ImmediateMfaResetFactory : ApiFactory
{
    protected override IEnumerable<(string Key, string Value)> ExtraSettings => [("Auth:MfaResetDelayHours", "0")];
}

file static class Mfa
{
    public static async Task<string> EnableAsync(HttpClient client)
    {
        var setup = await client.GetFromJsonAsync<JsonElement>("/api/auth/mfa/setup");
        var key = setup.GetProperty("sharedKey").GetString()!;
        (await client.PostAsJsonAsync("/api/auth/mfa/enable", new { code = new Totp(Base32Encoding.ToBytes(key)).ComputeTotp() })).EnsureSuccessStatusCode();
        return key;
    }

    /// <summary>A browser that has passed the password step and is waiting for a second factor.</summary>
    public static async Task<HttpClient> PasswordStepAsync(ApiFactory factory, string email)
    {
        var browser = factory.NewClient();
        var login = await browser.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Equal("mfaRequired", (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        return browser;
    }
}

[Collection("api")]
public class RecoveryTests(ApiFactory factory)
{
    [Fact]
    public async Task Losing_every_second_factor_starts_a_waiting_period_that_the_owner_can_cancel()
    {
        var (owner, email) = await factory.NewUserAsync();
        var key = await Mfa.EnableAsync(owner);

        // Nobody can start this without first passing the password step.
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.NewClient().PostAsync("/api/auth/mfa/recovery/request", null)).StatusCode);

        var stuck = await Mfa.PasswordStepAsync(factory, email);
        Assert.Equal(HttpStatusCode.Accepted, (await stuck.PostAsync("/api/auth/mfa/recovery/request", null)).StatusCode);
        var confirm = factory.Email.MfaResetToken(email, "Turn off two-step", "confirm");

        // A forged or wrong-purpose token does nothing.
        Assert.Equal(HttpStatusCode.BadRequest, (await stuck.PostAsJsonAsync("/api/auth/mfa/recovery/confirm", new { token = "bm9wZQ" })).StatusCode);
        var cancelToken = factory.Email.MfaResetToken(email, "Turn off two-step", "cancel");
        Assert.Equal(HttpStatusCode.BadRequest, (await stuck.PostAsJsonAsync("/api/auth/mfa/recovery/confirm", new { token = cancelToken })).StatusCode);

        var confirmed = await (await stuck.PostAsJsonAsync("/api/auth/mfa/recovery/confirm", new { token = confirm })).Content.ReadFromJsonAsync<JsonElement>();
        Assert.Equal("waiting", confirmed.GetProperty("status").GetString());
        Assert.True(confirmed.GetProperty("availableAt").GetDateTimeOffset() > DateTimeOffset.UtcNow.AddHours(71));

        // During the wait it cannot be completed…
        Assert.Equal("waiting", (await stuck.GetFromJsonAsync<JsonElement>("/api/auth/mfa/recovery/status")).GetProperty("state").GetString());
        var early = await stuck.PostAsync("/api/auth/mfa/recovery/complete", null);
        Assert.Equal(HttpStatusCode.Conflict, early.StatusCode);
        Assert.Equal(HttpStatusCode.Unauthorized, (await stuck.GetAsync("/api/auth/me")).StatusCode);

        // …and the real owner, who still has the authenticator, cancels it just by signing in.
        var real = await Mfa.PasswordStepAsync(factory, email);
        (await real.PostAsJsonAsync("/api/auth/login/mfa", new { code = new Totp(Base32Encoding.ToBytes(key)).ComputeTotp() })).EnsureSuccessStatusCode();
        Assert.Equal("none", (await stuck.GetFromJsonAsync<JsonElement>("/api/auth/mfa/recovery/status")).GetProperty("state").GetString());

        // Every step is in the owner's account activity.
        var activity = (await real.GetFromJsonAsync<JsonElement>("/api/auth/activity")).EnumerateArray().Select(e => e.GetProperty("event").GetString()).ToList();
        Assert.Contains("mfa_reset_requested", activity);
        Assert.Contains("mfa_reset_confirmed", activity);
        Assert.Contains("mfa_reset_cancelled", activity);
        Assert.Contains("sign_in_mfa", activity);
    }

    [Fact]
    public async Task The_cancel_link_stops_a_reset_and_kills_the_old_confirm_link()
    {
        var (owner, email) = await factory.NewUserAsync();
        await Mfa.EnableAsync(owner);
        var stuck = await Mfa.PasswordStepAsync(factory, email);
        await stuck.PostAsync("/api/auth/mfa/recovery/request", null);
        var confirm = factory.Email.MfaResetToken(email, "Turn off two-step", "confirm");
        var cancel = factory.Email.MfaResetToken(email, "Turn off two-step", "cancel");

        (await factory.NewClient().PostAsJsonAsync("/api/auth/mfa/recovery/cancel", new { token = cancel })).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.BadRequest, (await stuck.PostAsJsonAsync("/api/auth/mfa/recovery/confirm", new { token = confirm })).StatusCode);
    }

    [Fact]
    public async Task Account_activity_shows_only_the_owners_own_events()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, bobEmail) = await factory.NewUserAsync();
        await factory.NewClient().PostAsJsonAsync("/api/auth/login", new { email = bobEmail, password = "wrong password" });

        var aliceEvents = (await alice.GetFromJsonAsync<JsonElement>("/api/auth/activity")).EnumerateArray().Select(e => e.GetProperty("event").GetString()).ToList();
        Assert.Contains("account_created", aliceEvents);
        Assert.DoesNotContain("sign_in_failed", aliceEvents);
        Assert.Contains("sign_in_failed", (await bob.GetFromJsonAsync<JsonElement>("/api/auth/activity")).EnumerateArray().Select(e => e.GetProperty("event").GetString()));
        Assert.Equal(HttpStatusCode.Unauthorized, (await factory.NewClient().GetAsync("/api/auth/activity")).StatusCode);
    }

    [Fact]
    public async Task Browser_errors_are_accepted_bounded_and_rate_limited()
    {
        var client = factory.NewClient();
        var ok = await client.PostAsJsonAsync("/api/client-errors", new { kind = "render", message = "TypeError: x is undefined", route = "/planner?date=2026-11-16", reference = "ab12cd34" });
        Assert.Equal(HttpStatusCode.Accepted, ok.StatusCode);
        var tooLong = await client.PostAsJsonAsync("/api/client-errors", new { kind = "render", message = new string('x', 5000) });
        Assert.Equal(HttpStatusCode.BadRequest, tooLong.StatusCode);
        var badKind = await client.PostAsJsonAsync("/api/client-errors", new { kind = "sql", message = "m" });
        Assert.Equal(HttpStatusCode.BadRequest, badKind.StatusCode);

        var burst = await Task.WhenAll(Enumerable.Range(0, 25).Select(_ => client.PostAsJsonAsync("/api/client-errors", new { kind = "script", message = "m" })));
        Assert.Contains(burst, r => r.StatusCode == HttpStatusCode.TooManyRequests);
    }
}

public class ImmediateRecoveryTests(ImmediateMfaResetFactory factory) : IClassFixture<ImmediateMfaResetFactory>
{
    [Fact]
    public async Task After_the_wait_the_password_alone_finishes_the_reset_and_ends_other_sessions()
    {
        var (owner, email) = await factory.NewUserAsync();
        await Mfa.EnableAsync(owner);
        var stuck = await Mfa.PasswordStepAsync(factory, email);
        await stuck.PostAsync("/api/auth/mfa/recovery/request", null);
        (await stuck.PostAsJsonAsync("/api/auth/mfa/recovery/confirm", new { token = factory.Email.MfaResetToken(email, "Turn off two-step", "confirm") })).EnsureSuccessStatusCode();

        Assert.Equal("ready", (await stuck.GetFromJsonAsync<JsonElement>("/api/auth/mfa/recovery/status")).GetProperty("state").GetString());
        (await stuck.PostAsync("/api/auth/mfa/recovery/complete", null)).EnsureSuccessStatusCode();

        var me = await stuck.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.False(me.GetProperty("mfaEnabled").GetBoolean());
        Assert.Contains(factory.Email.To(email), m => m.Subject.StartsWith("Two-step verification was turned off"));
        // The session that was signed in before the reset is no longer valid.
        Assert.Equal(HttpStatusCode.Unauthorized, (await owner.GetAsync("/api/auth/me")).StatusCode);
    }
}
