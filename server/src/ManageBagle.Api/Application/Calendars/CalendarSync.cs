using System.Security.Cryptography;
using ManageBagle.Api.Data;
using ManageBagle.Api.Domain;
using ManageBagle.Api.Infrastructure;
using Microsoft.AspNetCore.DataProtection;
using Microsoft.AspNetCore.WebUtilities;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Application.Calendars;

/// <summary>Use cases for calendar export and busy-time import (P2-D, ADR-015).</summary>
public sealed class CalendarSync(AppDbContext db, IHttpClientFactory http, IDataProtectionProvider protection, TimeProvider clock, ILogger<CalendarSync> log)
{
    public const int MaxConnections = 5;
    public static readonly TimeSpan RefreshEvery = TimeSpan.FromMinutes(15);
    private readonly IDataProtector _secrets = protection.CreateProtector("calendar-secrets");

    // ---- Export ----------------------------------------------------------------------------------

    /// <summary>The account's secret feed token, created on first use. Regenerating stops the old link working.</summary>
    public async Task<string> FeedTokenAsync(Guid userId, bool regenerate, CancellationToken ct)
    {
        var user = await db.Users.FirstAsync(u => u.Id == userId, ct);
        if (!regenerate && user.CalendarFeedTokenProtected is { } stored) return _secrets.Unprotect(stored);
        var token = WebEncoders.Base64UrlEncode(RandomNumberGenerator.GetBytes(32));
        user.CalendarFeedTokenProtected = _secrets.Protect(token);
        user.CalendarFeedTokenHash = Hash(token);
        await db.SaveChangesAsync(ct);
        return token;
    }

    /// <summary>The feed for a token: 30 days back to 90 days ahead. Null when the token is unknown.</summary>
    public async Task<string?> FeedAsync(string token, CancellationToken ct)
    {
        if (token.Length is < 20 or > 100) return null;
        var hash = Hash(token);
        var userId = await db.Users.Where(u => u.CalendarFeedTokenHash == hash).Select(u => (Guid?)u.Id).FirstOrDefaultAsync(ct);
        if (userId is null) return null;
        var today = DateOnly.FromDateTime(clock.GetUtcNow().UtcDateTime);
        return await ExportAsync(userId.Value, today.AddDays(-30), today.AddDays(90), ct);
    }

    public async Task<string> ExportAsync(Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var blocks = await db.TimeBlocks.AsNoTracking().Where(b => b.UserId == userId && b.Date >= from && b.Date <= to)
            .OrderBy(b => b.Date).ThenBy(b => b.Start).ToListAsync(ct);
        return IcsWriter.Write(blocks, clock.GetUtcNow());
    }

    private static string Hash(string token) => Convert.ToHexString(SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(token)));

    // ---- Import ----------------------------------------------------------------------------------

    public Task<List<CalendarConnection>> ConnectionsAsync(Guid userId, CancellationToken ct) =>
        db.CalendarConnections.AsNoTracking().Where(c => c.UserId == userId).OrderBy(c => c.Name).ToListAsync(ct);

    public async Task<Result<CalendarConnection>> ConnectAsync(Guid userId, string name, string url, CancellationToken ct)
    {
        if (!SafeFetch.TryParseCalendarUrl(url, out var uri, out var error)) return Failure.Invalid("url", error);
        if (await db.CalendarConnections.CountAsync(c => c.UserId == userId, ct) >= MaxConnections)
        {
            return Failure.Invalid("url", $"You can connect up to {MaxConnections} calendars.");
        }
        var connection = new CalendarConnection
        {
            UserId = userId, Name = string.IsNullOrWhiteSpace(name) ? uri.Host : name.Trim(),
            UrlProtected = _secrets.Protect(uri.ToString()), Host = uri.Host,
        };
        // Read it once now, so a wrong address is reported straight away instead of failing silently later.
        if (await FetchAsync(connection, uri, ct) is { } problem) return Failure.Invalid("url", problem);
        db.CalendarConnections.Add(connection);
        await db.SaveChangesAsync(ct);
        return connection;
    }

    /// <summary>Re-reads connected calendars that are older than 15 minutes (or all, when forced).</summary>
    public async Task<List<CalendarConnection>> RefreshAsync(Guid userId, bool force, CancellationToken ct)
    {
        var connections = await db.CalendarConnections.Include(c => c.Events).Where(c => c.UserId == userId).ToListAsync(ct);
        var now = clock.GetUtcNow();
        foreach (var c in connections.Where(c => force || c.LastFetchedAt is null || now - c.LastFetchedAt > RefreshEvery))
        {
            await FetchAsync(c, new Uri(_secrets.Unprotect(c.UrlProtected)), ct);
        }
        await db.SaveChangesAsync(ct);
        return connections;
    }

    public async Task<bool> DisconnectAsync(Guid userId, Guid id, CancellationToken ct) =>
        await db.CalendarConnections.Where(c => c.Id == id && c.UserId == userId).ExecuteDeleteAsync(ct) > 0;

    /// <summary>Fetches and replaces the connection's events. On failure keeps the old events and records why.</summary>
    private async Task<string?> FetchAsync(CalendarConnection connection, Uri uri, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var zoneId = await db.Users.Where(u => u.Id == connection.UserId).Select(u => u.TimeZoneId).FirstOrDefaultAsync(ct);
        string? problem = null;
        try
        {
            using var timeout = CancellationTokenSource.CreateLinkedTokenSource(ct);
            timeout.CancelAfter(TimeSpan.FromSeconds(10));
            var text = await SafeFetch.ReadCalendarAsync(http.CreateClient(SafeFetch.ClientName), uri, timeout.Token);
            var events = IcsReader.Busy(text, now.AddDays(-1), now.AddDays(60), TimeZones.Find(zoneId));
            connection.Events.Clear();
            connection.Events.AddRange(events.Select(e => new ExternalEvent { UserId = connection.UserId, Title = e.Title, StartUtc = e.StartUtc, EndUtc = e.EndUtc }));
            connection.EventCount = events.Count;
            connection.LastError = "";
        }
        // Anything a stranger's server can make go wrong is reported, not thrown — except the caller giving up.
        catch (Exception e) when (!ct.IsCancellationRequested)
        {
            problem = e switch
            {
                TaskCanceledException => "The calendar did not answer within 10 seconds.",
                HttpRequestException { StatusCode: System.Net.HttpStatusCode.NotFound or System.Net.HttpStatusCode.Forbidden or System.Net.HttpStatusCode.Unauthorized } =>
                    "The calendar refused the address. Copy the private (secret) iCal address again.",
                HttpRequestException h when h.Message.StartsWith("The calendar", StringComparison.Ordinal) || h.Message.StartsWith("That calendar", StringComparison.Ordinal) => h.Message,
                HttpRequestException => "The calendar could not be reached.",
                _ => "That address did not return a calendar in iCal format.",
            };
            connection.LastError = problem;
            // The address is a secret: log the host only.
            log.LogWarning("Reading calendar on {Host} failed: {Reason}", connection.Host, e.GetType().Name);
        }
        connection.LastFetchedAt = now;
        return problem;
    }

    /// <summary>Imported busy events touching the given dates, in the account's time zone.</summary>
    public static async Task<IReadOnlyList<(Guid ConnectionId, string Title, DateOnly Date, TimeOnly Start, TimeOnly End, int Minutes)>> BusyOnAsync(
        AppDbContext db, Guid userId, DateOnly from, DateOnly to, CancellationToken ct) =>
        await BusyOnAsync(db, userId, from, to, TimeZones.Find(await db.Users.Where(u => u.Id == userId).Select(u => u.TimeZoneId).FirstOrDefaultAsync(ct)), ct);

    /// <summary>As above, for a caller that already knows the account's zone (saves a query).</summary>
    public static async Task<IReadOnlyList<(Guid ConnectionId, string Title, DateOnly Date, TimeOnly Start, TimeOnly End, int Minutes)>> BusyOnAsync(
        AppDbContext db, Guid userId, DateOnly from, DateOnly to, TimeZoneInfo? accountZone, CancellationToken ct)
    {
        var zone = accountZone ?? TimeZoneInfo.Utc;
        var windowStart = new DateTimeOffset(from.AddDays(-1).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var windowEnd = new DateTimeOffset(to.AddDays(2).ToDateTime(TimeOnly.MinValue), TimeSpan.Zero);
        var events = await db.ExternalEvents.AsNoTracking()
            .Where(e => e.UserId == userId && e.StartUtc < windowEnd && e.EndUtc > windowStart).OrderBy(e => e.StartUtc).ToListAsync(ct);
        return events.Select(e =>
            {
                var start = TimeZoneInfo.ConvertTime(e.StartUtc, zone);
                var end = TimeZoneInfo.ConvertTime(e.EndUtc, zone);
                return (e.ConnectionId, e.Title, DateOnly.FromDateTime(start.DateTime), TimeOnly.FromDateTime(start.DateTime), TimeOnly.FromDateTime(end.DateTime), (int)(e.EndUtc - e.StartUtc).TotalMinutes);
            })
            .Where(e => e.Item3 >= from && e.Item3 <= to)
            .ToList();
    }
}
