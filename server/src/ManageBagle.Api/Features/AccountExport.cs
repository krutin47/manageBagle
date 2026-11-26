using System.Security.Claims;
using System.Text.Json;
using ManageBagle.Api.Application.Planning;
using ManageBagle.Api.Auth;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

public record ExportProfile(string Email, string DisplayName, string? TimeZone, DateTimeOffset CreatedAt, bool TwoStepVerification, IEnumerable<string> SignInProviders);
public record ExportReview(DateOnly Date, string BiggestWin, string Interruptions, string ChangeTomorrow);
public record ExportCalendar(string Name, string Host, DateTimeOffset? LastFetchedAt, int EventCount);
public record ExportPreferences(TimeOnly? DayStart, TimeOnly? DayEnd, int? WaterReminderMinutes, string? BreakColor);
public record ExportOutcome(DateOnly Date, OutcomeResponse Outcome);

/// <summary>
/// Everything the account holds, as one JSON file (handbook §17.3; inventory in docs/data-inventory.md).
/// Left out on purpose: secrets (password hash, security stamp, authenticator key, recovery codes,
/// the private calendar addresses and the subscription link) and copies of other calendars' events,
/// which belong to those calendars.
/// </summary>
public record AccountExport(
    DateTimeOffset ExportedAt, ExportProfile Profile, ExportPreferences Preferences,
    IEnumerable<AreaResponse> FocusAreas, IEnumerable<ThemeResponse> DayThemes, IEnumerable<RoutineResponse> Routines,
    IEnumerable<TaskResponse> Tasks, IEnumerable<BlockResponse> Blocks, IEnumerable<ExportOutcome> TopThree,
    IEnumerable<ExportReview> Reviews, IEnumerable<ExportCalendar> ConnectedCalendars, IEnumerable<AuditEventResponse> Activity);

public static class AccountExportEndpoints
{
    public static void MapAccountExportEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/account/export", async (ClaimsPrincipal user, AppDbContext db, TimeProvider clock, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var u = await db.Users.AsNoTracking().FirstAsync(x => x.Id == uid, ct);
            var providers = await db.UserLogins.AsNoTracking().Where(l => l.UserId == uid).Select(l => l.LoginProvider).ToListAsync(ct);
            var now = clock.GetUtcNow();
            var export = new AccountExport(
                now,
                new ExportProfile(u.Email ?? "", u.DisplayName, u.TimeZoneId, u.CreatedAt, u.TwoFactorEnabled, providers),
                new ExportPreferences(u.DayStart, u.DayEnd, u.WaterReminderMinutes, u.BreakColor),
                (await db.FocusAreas.AsNoTracking().Where(a => a.UserId == uid).OrderBy(a => a.SortOrder).ToListAsync(ct)).Select(AreaResponse.From),
                await db.DayThemes.AsNoTracking().Where(t => t.UserId == uid).OrderBy(t => t.Day).Select(t => new ThemeResponse(t.Day, t.PrimaryFocus, t.Outcome, t.Review)).ToListAsync(ct),
                (await db.Routines.AsNoTracking().Include(r => r.Areas).Where(r => r.UserId == uid).ToListAsync(ct)).Select(RoutineResponse.From),
                (await db.BacklogTasks.AsNoTracking().Where(t => t.UserId == uid).OrderBy(t => t.CreatedAt).ToListAsync(ct)).Select(TaskResponse.From),
                (await db.TimeBlocks.AsNoTracking().Where(b => b.UserId == uid).OrderBy(b => b.Date).ThenBy(b => b.Start).ToListAsync(ct)).Select(BlockResponse.From),
                (await db.DailyOutcomes.AsNoTracking().Where(o => o.UserId == uid).OrderBy(o => o.Date).ThenBy(o => o.Rank).ToListAsync(ct)).Select(o => new ExportOutcome(o.Date, OutcomeResponse.From(o))),
                await db.DailyReviews.AsNoTracking().Where(r => r.UserId == uid).OrderBy(r => r.Date).Select(r => new ExportReview(r.Date, r.BiggestWin, r.Interruptions, r.ChangeTomorrow)).ToListAsync(ct),
                await db.CalendarConnections.AsNoTracking().Where(c => c.UserId == uid).Select(c => new ExportCalendar(c.Name, c.Host, c.LastFetchedAt, c.EventCount)).ToListAsync(ct),
                await db.AuditEvents.AsNoTracking().Where(e => e.UserId == uid).OrderBy(e => e.At).Select(e => new AuditEventResponse(e.Event, e.Detail, e.At)).ToListAsync(ct));

            await Audit.RecordAsync(app, "data_exported", uid);
            var json = JsonSerializer.SerializeToUtf8Bytes(export, new JsonSerializerOptions(JsonSerializerDefaults.Web) { WriteIndented = true });
            return Results.File(json, "application/json", $"managebagle-export-{now:yyyy-MM-dd}.json");
        })
        .RequireAuthorization().WithTags("Account")
        .Produces<AccountExport>(StatusCodes.Status200OK, "application/json");
    }
}
