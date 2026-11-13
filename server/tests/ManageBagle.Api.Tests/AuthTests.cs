using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using OtpNet;

namespace ManageBagle.Api.Tests;

[Collection("api")]
public class AuthTests(ApiFactory factory)
{
    private static string Totp(string sharedKey) => new Totp(Base32Encoding.ToBytes(sharedKey)).ComputeTotp();

    [Fact]
    public async Task Anonymous_requests_get_401_not_a_redirect()
    {
        var response = await factory.NewClient().GetAsync("/api/blocks?from=2026-11-16&to=2026-11-22");
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task State_changing_requests_without_the_client_header_are_rejected()
    {
        var response = await factory.NewClient(withClientHeader: false)
            .PostAsJsonAsync("/api/auth/login", new { email = "a@example.com", password = "x" });
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Register_signs_in_and_seeds_a_starting_system()
    {
        var (client, email) = await factory.NewUserAsync();

        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        Assert.Equal(email, me.GetProperty("email").GetString());
        Assert.False(me.GetProperty("mfaEnabled").GetBoolean());
        Assert.True(me.GetProperty("hasPassword").GetBoolean());

        Assert.Equal(8, (await client.GetFromJsonAsync<JsonElement>("/api/areas")).GetArrayLength());
        Assert.Equal(7, (await client.GetFromJsonAsync<JsonElement>("/api/themes")).GetArrayLength());
    }

    [Fact]
    public async Task Weak_or_duplicate_registrations_are_refused_with_field_errors()
    {
        var (_, email) = await factory.NewUserAsync();
        var client = factory.NewClient();

        var weak = await client.PostAsJsonAsync("/api/auth/register", new { email = "new@example.com", password = "short", displayName = "N" });
        Assert.Equal(HttpStatusCode.BadRequest, weak.StatusCode);
        Assert.True((await weak.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("errors").TryGetProperty("password", out _));

        var duplicate = await client.PostAsJsonAsync("/api/auth/register", new { email, password = ApiFactory.Password, displayName = "N" });
        Assert.Equal(HttpStatusCode.BadRequest, duplicate.StatusCode);
    }

    [Fact]
    public async Task Wrong_password_is_401_and_repeated_failures_lock_the_account()
    {
        var (_, email) = await factory.NewUserAsync();
        var client = factory.NewClient();

        for (var i = 0; i < 4; i++)
        {
            var bad = await client.PostAsJsonAsync("/api/auth/login", new { email, password = "not the password" });
            Assert.Equal(HttpStatusCode.Unauthorized, bad.StatusCode);
        }
        var fifth = await client.PostAsJsonAsync("/api/auth/login", new { email, password = "not the password" });
        Assert.Equal(HttpStatusCode.Locked, fifth.StatusCode);

        var correctWhileLocked = await client.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.Locked, correctWhileLocked.StatusCode);
    }

    [Fact]
    public async Task Mfa_full_cycle_enable_login_with_code_and_with_recovery_code()
    {
        var (client, email) = await factory.NewUserAsync();

        var setup = await client.GetFromJsonAsync<JsonElement>("/api/auth/mfa/setup");
        var key = setup.GetProperty("sharedKey").GetString()!;
        Assert.StartsWith("otpauth://totp/manageBagle:", setup.GetProperty("otpauthUri").GetString());

        var wrong = await client.PostAsJsonAsync("/api/auth/mfa/enable", new { code = "000000" });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);

        var enabled = await client.PostAsJsonAsync("/api/auth/mfa/enable", new { code = Totp(key) });
        enabled.EnsureSuccessStatusCode();
        var recovery = (await enabled.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("recoveryCodes");
        Assert.Equal(10, recovery.GetArrayLength());

        // A fresh browser: the password alone is no longer enough.
        var browser = factory.NewClient();
        var login = await browser.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Equal("mfaRequired", (await login.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.Unauthorized, (await browser.GetAsync("/api/auth/me")).StatusCode);

        var badCode = await browser.PostAsJsonAsync("/api/auth/login/mfa", new { code = "123456" });
        Assert.Equal(HttpStatusCode.Unauthorized, badCode.StatusCode);

        var goodCode = await browser.PostAsJsonAsync("/api/auth/login/mfa", new { code = Totp(key) });
        goodCode.EnsureSuccessStatusCode();
        Assert.True((await browser.GetFromJsonAsync<JsonElement>("/api/auth/me")).GetProperty("mfaEnabled").GetBoolean());

        // Another browser, phone lost: a recovery code works exactly once.
        var recoveryCode = recovery[0].GetString()!;
        foreach (var expected in new[] { HttpStatusCode.OK, HttpStatusCode.Unauthorized })
        {
            var other = factory.NewClient();
            await other.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
            var result = await other.PostAsJsonAsync("/api/auth/login/mfa", new { code = recoveryCode, useRecoveryCode = true });
            Assert.Equal(expected, result.StatusCode);
        }

        // Turning it off needs proof, then the password alone signs in again.
        var noProof = await client.PostAsJsonAsync("/api/auth/mfa/disable", new { password = "wrong password" });
        Assert.Equal(HttpStatusCode.Forbidden, noProof.StatusCode);
        (await client.PostAsJsonAsync("/api/auth/mfa/disable", new { password = ApiFactory.Password })).EnsureSuccessStatusCode();

        var after = await factory.NewClient().PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Equal("ok", (await after.Content.ReadFromJsonAsync<JsonElement>()).GetProperty("status").GetString());
    }

    [Fact]
    public async Task Mfa_step_without_a_password_step_is_refused()
    {
        var response = await factory.NewClient().PostAsJsonAsync("/api/auth/login/mfa", new { code = "123456" });
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Change_password_requires_the_current_one()
    {
        var (client, email) = await factory.NewUserAsync();

        var wrong = await client.PostAsJsonAsync("/api/auth/password", new { currentPassword = "nope nope nope", newPassword = "a brand new passphrase" });
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);

        (await client.PostAsJsonAsync("/api/auth/password", new { currentPassword = ApiFactory.Password, newPassword = "a brand new passphrase" })).EnsureSuccessStatusCode();

        var fresh = factory.NewClient();
        Assert.Equal(HttpStatusCode.Unauthorized, (await fresh.PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password })).StatusCode);
        (await fresh.PostAsJsonAsync("/api/auth/login", new { email, password = "a brand new passphrase" })).EnsureSuccessStatusCode();
    }

    [Fact]
    public async Task Forgot_password_never_reveals_whether_an_account_exists()
    {
        var (_, email) = await factory.NewUserAsync();
        var client = factory.NewClient();
        var known = await client.PostAsJsonAsync("/api/auth/password/forgot", new { email });
        var unknown = await client.PostAsJsonAsync("/api/auth/password/forgot", new { email = "nobody@example.com" });
        Assert.Equal(HttpStatusCode.Accepted, known.StatusCode);
        Assert.Equal(known.StatusCode, unknown.StatusCode);

        var reset = await client.PostAsJsonAsync("/api/auth/password/reset", new { email, token = "bm9wZQ", newPassword = "another long passphrase" });
        Assert.Equal(HttpStatusCode.BadRequest, reset.StatusCode);
    }

    [Fact]
    public async Task Logout_ends_the_session_and_google_is_hidden_when_unconfigured()
    {
        var (client, _) = await factory.NewUserAsync();
        (await client.PostAsync("/api/auth/logout", null)).EnsureSuccessStatusCode();
        Assert.Equal(HttpStatusCode.Unauthorized, (await client.GetAsync("/api/auth/me")).StatusCode);

        Assert.False((await client.GetFromJsonAsync<JsonElement>("/api/auth/providers")).GetProperty("google").GetBoolean());
        Assert.Equal(HttpStatusCode.NotFound, (await client.GetAsync("/api/auth/external/google")).StatusCode);
    }

    [Fact]
    public async Task Deleting_the_account_removes_the_user_and_their_data()
    {
        var (client, email) = await factory.NewUserAsync();
        Assert.Equal(HttpStatusCode.Forbidden, (await client.PostAsJsonAsync("/api/auth/account/delete", new { password = "wrong" })).StatusCode);
        (await client.PostAsJsonAsync("/api/auth/account/delete", new { password = ApiFactory.Password })).EnsureSuccessStatusCode();

        var login = await factory.NewClient().PostAsJsonAsync("/api/auth/login", new { email, password = ApiFactory.Password });
        Assert.Equal(HttpStatusCode.Unauthorized, login.StatusCode);
    }
}
