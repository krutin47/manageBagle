using System.Net;
using System.Text.Json;
using ManageBagle.Api.Data;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Infrastructure.Push;

public sealed record PushMessage(string Title, string Body, string Tag, string Url = "/");

public enum PushOutcome { Sent, Gone, Failed }

/// <summary>Sends notifications to browsers through their push services (ADR-019).</summary>
public sealed class PushService(AppDbContext db, IHttpClientFactory http, IDataProtectionProvider protection, IConfiguration config, TimeProvider clock, ILogger<PushService> log)
{
    public const string HttpClientName = "web-push";

    /// <summary>
    /// Push services of the browsers people use. The server posts to whatever endpoint a browser
    /// hands over, so anything else is refused: no request to an arbitrary or internal address.
    /// </summary>
    private static readonly string[] AllowedHostSuffixes = [".googleapis.com", ".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

    public static bool IsAllowedEndpoint(string endpoint) =>
        Uri.TryCreate(endpoint, UriKind.Absolute, out var uri) && uri.Scheme == Uri.UriSchemeHttps && uri.IsDefaultPort
        && AllowedHostSuffixes.Any(suffix => uri.Host.EndsWith(suffix, StringComparison.OrdinalIgnoreCase));

    private IDataProtector Protector => protection.CreateProtector("ManageBagle.WebPush.Vapid");

    /// <summary>The app's VAPID key pair, created the first time it is needed.</summary>
    public async Task<(byte[] Public, byte[] Private)> KeysAsync(CancellationToken ct)
    {
        var row = await db.PushKeys.AsNoTracking().FirstOrDefaultAsync(k => k.Id == 1, ct);
        if (row is null)
        {
            var (pub, priv) = WebPushCrypto.NewKeyPair();
            db.PushKeys.Add(new PushKey { Id = 1, PublicKey = WebPushCrypto.ToBase64Url(pub), PrivateKeyProtected = Protector.Protect(WebPushCrypto.ToBase64Url(priv)), CreatedAt = clock.GetUtcNow() });
            try { await db.SaveChangesAsync(ct); }
            catch (DbUpdateException) { db.ChangeTracker.Clear(); } // another instance created it first: use theirs
            row = await db.PushKeys.AsNoTracking().FirstAsync(k => k.Id == 1, ct);
        }
        return (WebPushCrypto.FromBase64Url(row.PublicKey), WebPushCrypto.FromBase64Url(Protector.Unprotect(row.PrivateKeyProtected)));
    }

    /// <summary>Sends to one subscription. A subscription the push service says is gone is deleted.</summary>
    public async Task<PushOutcome> SendAsync(PushSubscription subscription, PushMessage message, CancellationToken ct)
    {
        if (!IsAllowedEndpoint(subscription.Endpoint)) return PushOutcome.Failed;
        var (pub, priv) = await KeysAsync(ct);
        var payload = JsonSerializer.SerializeToUtf8Bytes(new { title = message.Title, body = message.Body, tag = message.Tag, url = message.Url });
        var body = WebPushCrypto.Encrypt(payload, WebPushCrypto.FromBase64Url(subscription.P256dh), WebPushCrypto.FromBase64Url(subscription.Auth));

        using var request = new HttpRequestMessage(HttpMethod.Post, subscription.Endpoint) { Content = new ByteArrayContent(body) };
        request.Content.Headers.ContentType = new("application/octet-stream");
        request.Content.Headers.ContentEncoding.Add("aes128gcm");
        request.Headers.TryAddWithoutValidation("TTL", "3600"); // a reminder an hour late is not worth showing
        request.Headers.TryAddWithoutValidation("Urgency", "normal");
        request.Headers.TryAddWithoutValidation("Topic", message.Tag.Length <= 32 ? message.Tag : message.Tag[..32]);
        var subject = config["Push:Subject"] ?? config["App:PublicUrl"] ?? "mailto:admin@managebagle.local";
        request.Headers.TryAddWithoutValidation("Authorization", WebPushCrypto.VapidAuthorization(subscription.Endpoint, subject, pub, priv, clock.GetUtcNow()));

        try
        {
            using var response = await http.CreateClient(HttpClientName).SendAsync(request, ct);
            if (response.StatusCode is HttpStatusCode.NotFound or HttpStatusCode.Gone)
            {
                await db.PushSubscriptions.Where(s => s.Id == subscription.Id).ExecuteDeleteAsync(ct);
                return PushOutcome.Gone;
            }
            if (!response.IsSuccessStatusCode)
            {
                log.LogWarning("Push service refused a notification: {Status} from {Host}", (int)response.StatusCode, new Uri(subscription.Endpoint).Host);
                return PushOutcome.Failed;
            }
            await db.PushSubscriptions.Where(s => s.Id == subscription.Id).ExecuteUpdateAsync(u => u.SetProperty(s => s.LastSentAt, clock.GetUtcNow()), ct);
            return PushOutcome.Sent;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            log.LogWarning("Could not reach the push service at {Host}: {Error}", new Uri(subscription.Endpoint).Host, e.GetType().Name);
            return PushOutcome.Failed;
        }
    }
}
