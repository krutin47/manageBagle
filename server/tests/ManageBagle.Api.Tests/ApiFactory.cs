using System.Collections.Concurrent;
using System.Net.Http.Json;
using System.Security.Claims;
using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.RegularExpressions;
using ManageBagle.Api.Auth;
using ManageBagle.Api.Data;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Authentication.Google;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.Mvc.Testing.Handlers;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;

namespace ManageBagle.Api.Tests;

/// <summary>
/// Boots the real API against a throwaway PostgreSQL database. Point MB_TEST_POSTGRES at any server
/// where the user may create databases (defaults to the docker-compose / CI service).
/// Two things are substituted: email is captured instead of sent, and "Google" is a stand-in identity
/// provider the tests control, so account-linking rules can be attacked without a real provider.
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _database = $"managebagle_test_{Guid.NewGuid():N}";

    public CapturedEmail Email { get; } = new();

    /// <summary>Settings a derived factory needs on top of the defaults.</summary>
    protected virtual IEnumerable<(string Key, string Value)> ExtraSettings => [];

    private string ConnectionString =>
        (Environment.GetEnvironmentVariable("MB_TEST_POSTGRES") ?? "Host=localhost;Port=5432;Username=managebagle;Password=managebagle")
        + $";Database={_database}";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", ConnectionString);
        builder.UseSetting("Database:MigrateOnStartup", "true");
        builder.UseSetting("RateLimits:AuthPerMinute", "10000");
        builder.UseSetting("Auth:SessionRevalidateSeconds", "0"); // so "other sessions end" is observable at once
        builder.UseSetting("RateLimits:CalendarFetchPerMinute", "1000");
        foreach (var (key, value) in ExtraSettings) builder.UseSetting(key, value); // last, so a derived factory can override the defaults above
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<IAppEmailSender>(Email);
            services.AddAuthentication().AddScheme<AuthenticationSchemeOptions, FakeProviderHandler>(GoogleDefaults.AuthenticationScheme, _ => { });
        });
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public new async Task DisposeAsync()
    {
        using (var scope = Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureDeletedAsync();
        }
        await base.DisposeAsync();
    }

    /// <summary>
    /// A browser-like client: keeps cookies, talks HTTPS, and — like the real app — sends the custom
    /// header and a fresh antiforgery token with every state-changing request. Pass false to play an
    /// attacker's page that can do neither.
    /// </summary>
    public HttpClient NewClient(bool likeTheApp = true)
    {
        var handlers = new List<DelegatingHandler>();
        if (likeTheApp) handlers.Add(new AppClientHandler());
        handlers.Add(new CookieContainerHandler());
        var client = CreateDefaultClient(new Uri("https://localhost"), [.. handlers]);
        return client;
    }

    public const string Password = "correct horse battery";

    /// <summary>Registers, opens the emailed confirmation link, and returns the signed-in browser.</summary>
    public async Task<(HttpClient Client, string Email)> NewUserAsync(string? timeZone = null)
    {
        var client = NewClient();
        var email = $"user-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/auth/register", new { email, password = Password, displayName = "Test User", timeZone });
        response.EnsureSuccessStatusCode();
        (await client.PostAsJsonAsync("/api/auth/email/confirm", Email.ConfirmationFor(email))).EnsureSuccessStatusCode();
        return (client, email);
    }

    private sealed class AppClientHandler : DelegatingHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
        {
            if (request.Method != HttpMethod.Get && request.Method != HttpMethod.Head)
            {
                using var tokenResponse = await base.SendAsync(new HttpRequestMessage(HttpMethod.Get, new Uri(request.RequestUri!, "/api/auth/csrf")), ct);
                var token = (await tokenResponse.Content.ReadFromJsonAsync<JsonElement>(ct)).GetProperty("token").GetString();
                request.Headers.TryAddWithoutValidation("X-MB-Client", "tests");
                if (!request.Headers.Contains("X-CSRF-TOKEN")) request.Headers.TryAddWithoutValidation("X-CSRF-TOKEN", token);
            }
            return await base.SendAsync(request, ct);
        }
    }
}

public record ConfirmEmail(Guid UserId, string Token);

public sealed partial class CapturedEmail : IAppEmailSender
{
    public ConcurrentQueue<(string To, string Subject, string Body)> Sent { get; } = new();

    public Task SendAsync(string to, string subject, string textBody, CancellationToken ct = default)
    {
        Sent.Enqueue((to, subject, textBody));
        return Task.CompletedTask;
    }

    public IEnumerable<(string To, string Subject, string Body)> To(string address) => Sent.Where(m => m.To == address);

    /// <summary>The body the confirmation page would post, taken from the newest confirmation email.</summary>
    public ConfirmEmail ConfirmationFor(string address)
    {
        var body = To(address).Last(m => m.Subject.StartsWith("Confirm")).Body;
        var match = ConfirmLink().Match(body);
        return new ConfirmEmail(Guid.Parse(match.Groups[1].Value), match.Groups[2].Value);
    }

    /// <summary>The token in the newest link of the given kind, e.g. ("Turn off two-step", "confirm").</summary>
    public string MfaResetToken(string address, string subjectStartsWith, string action) =>
        Regex.Match(To(address).Last(m => m.Subject.StartsWith(subjectStartsWith)).Body, $@"/mfa-recovery\?action={action}&token=([\w-]+)").Groups[1].Value;

    public string ResetTokenFor(string address) => ResetLink().Match(To(address).Last(m => m.Subject.StartsWith("Reset")).Body).Groups[1].Value;

    [GeneratedRegex(@"/confirm-email\?userId=([0-9a-f-]+)&token=([\w-]+)")]
    private static partial Regex ConfirmLink();

    [GeneratedRegex(@"/reset-password\?email=[^&]+&token=([\w-]+)")]
    private static partial Regex ResetLink();
}

/// <summary>
/// Stands in for Google. The "user" at the provider is whatever the test puts in the X-Fake-* headers
/// of the request that starts the sign-in, exactly as a real provider would return its own claims.
/// </summary>
public sealed class FakeProviderHandler(IOptionsMonitor<AuthenticationSchemeOptions> options, ILoggerFactory logger, UrlEncoder encoder)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync() => Task.FromResult(AuthenticateResult.NoResult());

    protected override async Task HandleChallengeAsync(AuthenticationProperties properties)
    {
        var claims = new List<Claim>
        {
            new(ClaimTypes.NameIdentifier, Request.Headers["X-Fake-Sub"].ToString()),
            new(ClaimTypes.Email, Request.Headers["X-Fake-Email"].ToString()),
            new(ClaimTypes.GivenName, "Fake"),
            new("email_verified", Request.Headers["X-Fake-Verified"].ToString() is "false" ? "false" : "true"),
        };
        var principal = new ClaimsPrincipal(new ClaimsIdentity(claims, Scheme.Name));
        await Context.SignInAsync(IdentityConstants.ExternalScheme, principal, properties);
        Response.Redirect(properties.RedirectUri!);
    }
}

public static class FakeProvider
{
    /// <summary>Runs a whole "Continue with Google" round trip and returns where the app finally sent the browser.</summary>
    public static async Task<string> SignInAsync(HttpClient client, string sub, string email, bool verified = true, string path = "/api/auth/external/google")
    {
        var start = new HttpRequestMessage(HttpMethod.Get, path);
        start.Headers.Add("X-Fake-Sub", sub);
        start.Headers.Add("X-Fake-Email", email);
        start.Headers.Add("X-Fake-Verified", verified ? "true" : "false");
        var toCallback = await client.SendAsync(start);
        if (toCallback.Headers.Location is null) return $"{(int)toCallback.StatusCode}";
        // Refused before reaching the provider: the app sent the browser straight back to a page.
        if (!toCallback.Headers.Location.ToString().StartsWith("/api/")) return toCallback.Headers.Location.ToString();
        var final = await client.GetAsync(toCallback.Headers.Location);
        return final.Headers.Location?.ToString() ?? $"{(int)final.StatusCode}";
    }
}

[CollectionDefinition("api")]
public class ApiCollection : ICollectionFixture<ApiFactory>;
