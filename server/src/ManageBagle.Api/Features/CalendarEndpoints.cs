using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Application.Calendars;
using ManageBagle.Api.Auth;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;

namespace ManageBagle.Api.Features;

public record ConnectCalendarRequest([StringLength(80)] string? Name, [Required, StringLength(2000)] string Url);

public record CalendarConnectionResponse(Guid Id, string Name, string Host, DateTimeOffset? LastFetchedAt, string LastError, int EventCount)
{
    public static CalendarConnectionResponse From(CalendarConnection c) => new(c.Id, c.Name, c.Host, c.LastFetchedAt, c.LastError, c.EventCount);
}

public record CalendarFeedResponse(string Url, string WebcalUrl);

public static class CalendarEndpoints
{
    public static void MapCalendarEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/calendar").RequireAuthorization().WithTags("Calendars");

        // ---- Export (P2-D1) ----
        g.MapGet("/feed", async (ClaimsPrincipal user, CalendarSync sync, AccountLinks links, CancellationToken ct) =>
            Feed(links, await sync.FeedTokenAsync(user.UserId(), regenerate: false, ct))).Produces<CalendarFeedResponse>();

        g.MapPost("/feed/regenerate", async (ClaimsPrincipal user, CalendarSync sync, AccountLinks links, CancellationToken ct) =>
        {
            var token = await sync.FeedTokenAsync(user.UserId(), regenerate: true, ct);
            await Audit.RecordAsync(app, "calendar_feed_regenerated", user.UserId());
            return Feed(links, token);
        }).Produces<CalendarFeedResponse>();

        g.MapGet("/export.ics", async (DateOnly from, DateOnly to, ClaimsPrincipal user, CalendarSync sync, CancellationToken ct) =>
        {
            if (to < from || to.DayNumber - from.DayNumber > 366) return HttpExtensions.Invalid("to", "Export at most a year at a time.");
            var ics = await sync.ExportAsync(user.UserId(), from, to, ct);
            return Results.File(System.Text.Encoding.UTF8.GetBytes(ics), "text/calendar; charset=utf-8", $"managebagle-{from:yyyyMMdd}-{to:yyyyMMdd}.ics");
        }).Produces(StatusCodes.Status200OK, contentType: "text/calendar");

        // The subscription link calendar apps poll. The token is the only credential: no cookie, read-only.
        app.MapGet("/api/calendar/feed/{token}.ics", async (string token, HttpContext http, CalendarSync sync, CancellationToken ct) =>
        {
            var ics = await sync.FeedAsync(token, ct);
            if (ics is null) return Results.NotFound();
            http.Response.Headers.CacheControl = "private, max-age=300";
            return Results.Text(ics, "text/calendar; charset=utf-8");
        }).RequireRateLimiting("calendar-feed").ExcludeFromDescription().Produces(StatusCodes.Status200OK, contentType: "text/calendar");

        // ---- Import busy time (P2-D2) ----
        g.MapGet("/connections", async (ClaimsPrincipal user, CalendarSync sync, CancellationToken ct) =>
            (await sync.ConnectionsAsync(user.UserId(), ct)).Select(CalendarConnectionResponse.From));

        g.MapPost("/connections", async (ConnectCalendarRequest req, ClaimsPrincipal user, CalendarSync sync, CancellationToken ct) =>
            (await sync.ConnectAsync(user.UserId(), req.Name ?? "", req.Url, ct)).ToHttp(c => Results.Created($"/api/calendar/connections/{c.Id}", CalendarConnectionResponse.From(c))))
            .RequireRateLimiting("calendar-fetch").Produces<CalendarConnectionResponse>(StatusCodes.Status201Created).ProducesValidationProblem();

        // Re-reads calendars older than 15 minutes; the screens call this when they open.
        g.MapPost("/connections/refresh", async (bool? force, ClaimsPrincipal user, CalendarSync sync, CancellationToken ct) =>
            (await sync.RefreshAsync(user.UserId(), force ?? false, ct)).Select(CalendarConnectionResponse.From))
            .RequireRateLimiting("calendar-fetch");

        g.MapDelete("/connections/{id:guid}", async (Guid id, ClaimsPrincipal user, CalendarSync sync, CancellationToken ct) =>
            await sync.DisconnectAsync(user.UserId(), id, ct) ? Results.NoContent() : Results.NotFound())
            .Produces(StatusCodes.Status204NoContent).Produces(StatusCodes.Status404NotFound);
    }

    private static CalendarFeedResponse Feed(AccountLinks links, string token)
    {
        var url = links.Url($"/api/calendar/feed/{token}.ics");
        return new CalendarFeedResponse(url, "webcal://" + url[(url.IndexOf("://", StringComparison.Ordinal) + 3)..]);
    }
}
