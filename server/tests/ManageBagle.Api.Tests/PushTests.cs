using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using ManageBagle.Api.Infrastructure.Push;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Time.Testing;

namespace ManageBagle.Api.Tests;

/// <summary>Stands in for the browsers' push services: records every request and answers as told.</summary>
public sealed class FakePushService : HttpMessageHandler
{
    public ConcurrentQueue<(string Endpoint, HttpRequestMessage Request, byte[] Body)> Received { get; } = new();
    public HttpStatusCode Answer { get; set; } = HttpStatusCode.Created;
    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken ct)
    {
        Received.Enqueue((request.RequestUri!.ToString(), request, await request.Content!.ReadAsByteArrayAsync(ct)));
        return new HttpResponseMessage(Answer);
    }
}

public sealed class PushFactory : ApiFactory
{
    public FakeTimeProvider Clock { get; } = new(DateTimeOffset.UtcNow);
    public FakePushService PushServices { get; } = new();
    protected override IEnumerable<(string Key, string Value)> ExtraSettings => [("Push:SchedulerEnabled", "false"), ("App:PublicUrl", "https://managebagle.test")];
    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        base.ConfigureWebHost(builder);
        builder.ConfigureTestServices(services =>
        {
            services.AddSingleton<TimeProvider>(Clock);
            services.AddHttpClient(PushService.HttpClientName).ConfigurePrimaryHttpMessageHandler(() => PushServices);
        });
    }
}

/// <summary>A browser: its own key pair and auth secret, and the ability to decrypt what it is sent.</summary>
public sealed class FakeBrowser
{
    private readonly ECDiffieHellman _key = ECDiffieHellman.Create(ECCurve.NamedCurves.nistP256);
    public byte[] Auth { get; } = RandomNumberGenerator.GetBytes(16);
    public string Endpoint { get; } = $"https://fcm.googleapis.com/fcm/send/{Guid.NewGuid():N}";
    public byte[] PublicKey { get { var p = _key.ExportParameters(false); return [0x04, .. p.Q.X!, .. p.Q.Y!]; } }

    public object Subscription => new { endpoint = Endpoint, keys = new { p256dh = WebPushCrypto.ToBase64Url(PublicKey), auth = WebPushCrypto.ToBase64Url(Auth) } };

    /// <summary>RFC 8291 decryption, written independently of the sender's code.</summary>
    public JsonElement Decrypt(byte[] body)
    {
        var salt = body[..16];
        var recordSize = BinaryPrimitives.ReadUInt32BigEndian(body.AsSpan(16, 4));
        Assert.Equal(4096u, recordSize);
        var keyLength = body[20];
        var senderPublic = body[21..(21 + keyLength)];
        var ciphertext = body[(21 + keyLength)..];
        using var sender = ECDiffieHellman.Create(new ECParameters { Curve = ECCurve.NamedCurves.nistP256, Q = new ECPoint { X = senderPublic[1..33], Y = senderPublic[33..] } });
        var shared = _key.DeriveRawSecretAgreement(sender.PublicKey);
        var ikm = HKDF.DeriveKey(HashAlgorithmName.SHA256, shared, 32, Auth, [.. "WebPush: info\0"u8, .. PublicKey, .. senderPublic]);
        var prk = HKDF.Extract(HashAlgorithmName.SHA256, ikm, salt);
        var cek = HKDF.Expand(HashAlgorithmName.SHA256, prk, 16, "Content-Encoding: aes128gcm\0"u8.ToArray());
        var nonce = HKDF.Expand(HashAlgorithmName.SHA256, prk, 12, "Content-Encoding: nonce\0"u8.ToArray());
        var plain = new byte[ciphertext.Length - 16];
        using (var aes = new AesGcm(cek, 16)) aes.Decrypt(nonce, ciphertext[..^16], ciphertext[^16..], plain);
        Assert.Equal(0x02, plain[^1]); // last-record delimiter
        return JsonDocument.Parse(plain.AsMemory(0, plain.Length - 1)).RootElement.Clone();
    }
}

/// <summary>P2-C5 / ADR-019: reminders reach a closed app, once, privately.</summary>
public class PushTests(PushFactory factory) : IClassFixture<PushFactory>
{
    private static async Task<JsonElement> Json(HttpResponseMessage r)
    {
        Assert.True(r.IsSuccessStatusCode, $"{(int)r.StatusCode}: {await r.Content.ReadAsStringAsync()}");
        var text = await r.Content.ReadAsStringAsync();
        return text.Length == 0 ? default : JsonDocument.Parse(text).RootElement.Clone();
    }

    /// <summary>Moves the clock forward to the next day at the given time (the fake clock only goes forward).</summary>
    private void NextDayAt(int hour, int minute, int second = 0) =>
        factory.Clock.SetUtcNow(new DateTimeOffset(factory.Clock.GetUtcNow().UtcDateTime.Date.AddDays(1).AddHours(hour).AddMinutes(minute).AddSeconds(second), TimeSpan.Zero));

    private async Task<int> RunScheduler()
    {
        await using var scope = factory.Services.CreateAsyncScope();
        return await scope.ServiceProvider.GetRequiredService<PushReminders>().RunAsync(default);
    }

    private (string Endpoint, HttpRequestMessage Request, byte[] Body)[] SentTo(FakeBrowser browser) => factory.PushServices.Received.Where(r => r.Endpoint == browser.Endpoint).ToArray();

    [Fact]
    public async Task Only_real_push_services_and_well_formed_keys_are_accepted()
    {
        var (client, _) = await factory.NewUserAsync();
        var key1 = await client.GetFromJsonAsync<JsonElement>("/api/push/key");
        var key2 = await client.GetFromJsonAsync<JsonElement>("/api/push/key");
        Assert.Equal(key1.GetProperty("publicKey").GetString(), key2.GetProperty("publicKey").GetString()); // created once, then reused
        Assert.Equal(65, WebPushCrypto.FromBase64Url(key1.GetProperty("publicKey").GetString()!).Length);

        var browser = new FakeBrowser();
        foreach (var endpoint in new[] { "https://evil.example.com/push", "http://fcm.googleapis.com/fcm/send/x", "https://fcm.googleapis.com.evil.com/x", "https://127.0.0.1/x", "https://fcm.googleapis.com:8443/x" })
        {
            var r = await client.PostAsJsonAsync("/api/push/subscriptions", new { endpoint, keys = new { p256dh = WebPushCrypto.ToBase64Url(browser.PublicKey), auth = WebPushCrypto.ToBase64Url(browser.Auth) } });
            Assert.Equal(HttpStatusCode.BadRequest, r.StatusCode);
        }
        var badKey = await client.PostAsJsonAsync("/api/push/subscriptions", new { endpoint = browser.Endpoint, keys = new { p256dh = "AAAA", auth = WebPushCrypto.ToBase64Url(browser.Auth) } });
        Assert.Equal(HttpStatusCode.BadRequest, badKey.StatusCode);
        Assert.Equal(HttpStatusCode.NoContent, (await client.PostAsJsonAsync("/api/push/subscriptions", browser.Subscription)).StatusCode);
    }

    [Fact]
    public async Task A_water_reminder_reaches_the_closed_app_once_encrypted_and_signed()
    {
        var (client, _) = await factory.NewUserAsync();
        await Json(await client.PutAsJsonAsync("/api/preferences", new { dayStart = "08:00:00", dayEnd = "21:00:00", waterReminderMinutes = 60 }));
        var browser = new FakeBrowser();
        await Json(await client.PostAsJsonAsync("/api/push/subscriptions", browser.Subscription));

        NextDayAt(10, 0, 30); // 10:00 is a water time: 08:00 + 2 × 60
        await RunScheduler();
        var sent = Assert.Single(SentTo(browser));
        var message = browser.Decrypt(sent.Body);
        Assert.Equal("Time for some water", message.GetProperty("title").GetString());
        Assert.StartsWith("vapid t=", sent.Request.Headers.GetValues("Authorization").Single());
        Assert.Equal("aes128gcm", sent.Request.Content!.Headers.ContentEncoding.Single());
        Assert.Equal("3600", sent.Request.Headers.GetValues("TTL").Single());

        // A second run (another instance, or a restart) in the same minute sends nothing more.
        await RunScheduler();
        factory.Clock.Advance(TimeSpan.FromMinutes(1));
        await RunScheduler();
        Assert.Single(SentTo(browser));
    }

    [Fact]
    public async Task Meal_routines_and_a_running_timer_send_their_reminders()
    {
        var (client, _) = await factory.NewUserAsync();
        await Json(await client.PutAsJsonAsync("/api/preferences", new { dayStart = "08:00:00", dayEnd = "21:00:00", waterReminderMinutes = (int?)null }));
        await Json(await client.PostAsJsonAsync("/api/routines", new { title = "Lunch", days = "Everyday", start = "12:30:00", end = "13:15:00", taskPolicy = "NoTasks", isMeal = true }));
        var browser = new FakeBrowser();
        await Json(await client.PostAsJsonAsync("/api/push/subscriptions", browser.Subscription));

        NextDayAt(12, 31);
        await RunScheduler();
        Assert.Equal("Lunch time", browser.Decrypt(Assert.Single(SentTo(browser)).Body).GetProperty("title").GetString());

        var today = DateOnly.FromDateTime(factory.Clock.GetUtcNow().UtcDateTime).ToString("yyyy-MM-dd");
        var block = await Json(await client.PostAsJsonAsync("/api/blocks", new { date = today, start = "14:00:00", end = "14:30:00", title = "Write the summary", priority = "High", workMode = "DeepFocus", status = "Planned" }));
        await Json(await client.PostAsJsonAsync($"/api/blocks/{block.GetProperty("id").GetGuid()}/timer/start", new { pauseRunning = false }));
        factory.Clock.Advance(TimeSpan.FromMinutes(31));
        await RunScheduler();
        var timeUp = browser.Decrypt(SentTo(browser).Last().Body);
        Assert.Equal("Time's up", timeUp.GetProperty("title").GetString());
        Assert.Contains("Write the summary", timeUp.GetProperty("body").GetString());
    }

    [Fact]
    public async Task A_browser_the_push_service_has_forgotten_is_removed_and_people_manage_only_their_own()
    {
        var (alice, _) = await factory.NewUserAsync();
        var (bob, _) = await factory.NewUserAsync();
        var aliceBrowser = new FakeBrowser();
        await Json(await alice.PostAsJsonAsync("/api/push/subscriptions", aliceBrowser.Subscription));

        // Bob cannot remove Alice's device.
        await Json(await bob.PostAsJsonAsync("/api/push/subscriptions/remove", new { endpoint = aliceBrowser.Endpoint }));
        Assert.Equal(1, (await Json(await alice.PostAsync("/api/push/test", null))).GetProperty("devices").GetInt32());

        factory.PushServices.Answer = HttpStatusCode.Gone;
        try
        {
            var result = await Json(await alice.PostAsync("/api/push/test", null));
            Assert.Equal(0, result.GetProperty("sent").GetInt32());
            Assert.Equal(0, (await Json(await alice.PostAsync("/api/push/test", null))).GetProperty("devices").GetInt32()); // forgotten
        }
        finally
        {
            factory.PushServices.Answer = HttpStatusCode.Created;
        }
    }
}
