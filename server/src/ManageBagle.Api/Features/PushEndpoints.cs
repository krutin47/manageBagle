using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using ManageBagle.Api.Infrastructure.Push;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

public record PushKeyResponse(string PublicKey);
public record PushSubscriptionKeys([Required, StringLength(200)] string P256dh, [Required, StringLength(100)] string Auth);
public record PushSubscribeRequest([Required, StringLength(1000)] string Endpoint, [Required] PushSubscriptionKeys Keys);
public record PushUnsubscribeRequest([Required, StringLength(1000)] string Endpoint);
public record PushTestResponse(int Sent, int Devices);

/// <summary>Notifications while the app is closed (P2-C5, ADR-019).</summary>
public static class PushEndpoints
{
    /// <summary>A person rarely has more than a few browsers; the oldest beyond this are forgotten.</summary>
    public const int MaxDevices = 10;

    public static void MapPushEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/push").RequireAuthorization().WithTags("Notifications");

        g.MapGet("/key", async (PushService push, CancellationToken ct) => Results.Ok(new PushKeyResponse(WebPushCrypto.ToBase64Url((await push.KeysAsync(ct)).Public))))
            .Produces<PushKeyResponse>();

        g.MapPost("/subscriptions", async (PushSubscribeRequest req, ClaimsPrincipal user, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            if (!PushService.IsAllowedEndpoint(req.Endpoint)) return HttpExtensions.Invalid("endpoint", "This browser's notification service is not supported.");
            byte[] key, auth;
            try { (key, auth) = (WebPushCrypto.FromBase64Url(req.Keys.P256dh), WebPushCrypto.FromBase64Url(req.Keys.Auth)); }
            catch (FormatException) { return HttpExtensions.Invalid("keys", "The subscription keys are not valid."); }
            if (key.Length != 65 || key[0] != 0x04 || auth.Length != 16) return HttpExtensions.Invalid("keys", "The subscription keys are not valid.");

            var uid = user.UserId();
            // One browser, one row: if another account used this browser before, the subscription moves to this one.
            var existing = await db.PushSubscriptions.FirstOrDefaultAsync(s => s.Endpoint == req.Endpoint, ct);
            if (existing is null) db.PushSubscriptions.Add(new PushSubscription { UserId = uid, Endpoint = req.Endpoint, P256dh = req.Keys.P256dh, Auth = req.Keys.Auth, CreatedAt = clock.GetUtcNow() });
            else { existing.UserId = uid; existing.P256dh = req.Keys.P256dh; existing.Auth = req.Keys.Auth; }
            await db.SaveChangesAsync(ct);

            var stale = await db.PushSubscriptions.Where(s => s.UserId == uid).OrderByDescending(s => s.CreatedAt).Skip(MaxDevices).Select(s => s.Id).ToListAsync(ct);
            if (stale.Count > 0) await db.PushSubscriptions.Where(s => stale.Contains(s.Id)).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        }).Produces(StatusCodes.Status204NoContent).ProducesValidationProblem();

        g.MapPost("/subscriptions/remove", async (PushUnsubscribeRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            await db.PushSubscriptions.Where(s => s.UserId == uid && s.Endpoint == req.Endpoint).ExecuteDeleteAsync(ct);
            return Results.NoContent();
        }).Produces(StatusCodes.Status204NoContent);

        g.MapPost("/test", async (ClaimsPrincipal user, AppDbContext db, PushService push, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var devices = await db.PushSubscriptions.AsNoTracking().Where(s => s.UserId == uid).ToListAsync(ct);
            var sent = 0;
            foreach (var device in devices)
            {
                if (await push.SendAsync(device, new PushMessage("Notifications are on", "You will get reminders here even when manageBagle is closed.", "test"), ct) == PushOutcome.Sent) sent++;
            }
            return Results.Ok(new PushTestResponse(sent, devices.Count));
        }).RequireRateLimiting("calendar-fetch").Produces<PushTestResponse>();
    }
}
