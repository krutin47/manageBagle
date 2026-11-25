using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using Sentry;
using Sentry.Extensibility;
using Sentry.Extensions.Logging;
using Sentry.Protocol.Envelopes;

namespace ManageBagle.Api.Tests;

/// <summary>Stands in for sentry.io: keeps every envelope the SDK would have sent.</summary>
public sealed class CapturedSentry : ITransport
{
    public ConcurrentQueue<string> Sent { get; } = new();
    public async Task SendEnvelopeAsync(Envelope envelope, CancellationToken cancellationToken = default)
    {
        using var stream = new MemoryStream();
        await envelope.SerializeAsync(stream, null, cancellationToken);
        Sent.Enqueue(System.Text.Encoding.UTF8.GetString(stream.ToArray()));
    }
}

public sealed class SentryFactory : ApiFactory
{
    public CapturedSentry Sentry { get; } = new();
    protected override IEnumerable<(string Key, string Value)> ExtraSettings => [("Sentry:Dsn", "https://public@example.invalid/1")];
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services => services.Configure<SentryLoggingOptions>(o => o.Transport = Sentry));
    }
}

/// <summary>ADR-018: errors reach Sentry; personal data does not.</summary>
public class ErrorReportingTests(SentryFactory factory) : IClassFixture<SentryFactory>
{
    private async Task<string> WaitFor(string text)
    {
        for (var i = 0; i < 50; i++)
        {
            await SentrySdk.FlushAsync(TimeSpan.FromSeconds(1));
            if (factory.Sentry.Sent.FirstOrDefault(e => e.Contains(text)) is { } found) return found;
            await Task.Delay(100);
        }
        throw new Xunit.Sdk.XunitException($"Nothing containing \"{text}\" was sent. Sent: {factory.Sentry.Sent.Count} envelopes.");
    }

    [Fact]
    public async Task A_browser_error_is_forwarded_with_the_account_id_and_without_personal_data()
    {
        var (client, email) = await factory.NewUserAsync();
        var me = await client.GetFromJsonAsync<JsonElement>("/api/auth/me");
        var marker = $"Boom {Guid.NewGuid():N}";
        var r = await client.PostAsJsonAsync("/api/client-errors", new { kind = "script", message = marker, route = "/planner?token=very-secret#x", reference = "REF123" });
        Assert.Equal(HttpStatusCode.Accepted, r.StatusCode);

        var sent = await WaitFor(marker);
        Assert.Contains(me.GetProperty("id").GetString()!, sent);
        Assert.Contains("REF123", sent);
        Assert.DoesNotContain(email, sent);
        Assert.DoesNotContain("very-secret", sent); // the query string is cut before it leaves
        Assert.DoesNotContain(".AspNetCore.Identity.Application", sent); // no session cookie
        Assert.DoesNotContain("Cookie", sent, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task A_server_failure_logged_as_an_error_is_reported_and_warnings_are_not()
    {
        _ = factory.CreateClient();
        var logger = factory.Services.GetRequiredService<ILoggerFactory>().CreateLogger("ManageBagle.Test");
        var marker = Guid.NewGuid().ToString("N");
        logger.LogWarning("Only a warning {Marker}", $"warn-{marker}");
        logger.LogError(new InvalidOperationException($"failure-{marker}"), "Unhandled failure in {Method} {Route}", "GET", "/api/test");

        var sent = await WaitFor($"failure-{marker}");
        Assert.Contains("InvalidOperationException", sent);
        Assert.DoesNotContain(factory.Sentry.Sent, e => e.Contains($"\"warn-{marker}") && !e.Contains("breadcrumbs"));
    }
}
