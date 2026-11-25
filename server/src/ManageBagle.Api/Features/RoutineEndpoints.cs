using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Domain;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

public record RoutineRequest(
    [Required, StringLength(80, MinimumLength = 1)] string Title,
    Weekdays Days,
    TimeOnly Start,
    TimeOnly End,
    TaskPolicy TaskPolicy,
    Guid[]? AreaIds,
    bool IsMeal = false,
    string? Color = null);

public record RoutineResponse(Guid Id, string Title, Weekdays Days, TimeOnly Start, TimeOnly End, TaskPolicy TaskPolicy, IReadOnlyList<Guid> AreaIds, bool IsMeal, string? Color)
{
    public static RoutineResponse From(Routine r) => new(r.Id, r.Title, r.Days, r.Start, r.End, r.TaskPolicy, r.Areas.Select(a => a.FocusAreaId).ToList(), r.IsMeal, r.Color);
}

/// <summary>Something already occupying time on a date: a routine occurrence (later also calendar events).</summary>
public record CommitmentResponse(string Kind, Guid SourceId, string Title, DateOnly Date, TimeOnly Start, TimeOnly End, int Minutes, TaskPolicy TaskPolicy, IReadOnlyList<Guid> AreaIds, bool IsMeal, string? Color);

public record PreferencesRequest(TimeOnly DayStart, TimeOnly DayEnd, int? WaterReminderMinutes, string? BreakColor = null);

public record PreferencesResponse(TimeOnly DayStart, TimeOnly DayEnd, int? WaterReminderMinutes, string? BreakColor);

public static class RoutineEndpoints
{
    public const int MaxRoutines = 20;
    public static readonly TimeOnly DefaultDayStart = new(8, 0);
    public static readonly TimeOnly DefaultDayEnd = new(21, 0);
    private static readonly int[] WaterIntervals = [30, 45, 60, 90, 120];

    public static void MapRoutineEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api").RequireAuthorization().WithTags("Routines");

        g.MapGet("/routines", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var routines = await db.Routines.AsNoTracking().Include(r => r.Areas).Where(r => r.UserId == uid).OrderBy(r => r.Start).ToListAsync(ct);
            return routines.Select(RoutineResponse.From);
        });

        g.MapPost("/routines", async (RoutineRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            if (await db.Routines.CountAsync(r => r.UserId == uid, ct) >= MaxRoutines) return HttpExtensions.Invalid("title", $"You can have up to {MaxRoutines} routines.");
            var routine = new Routine { UserId = uid };
            if (await Apply(routine, req, uid, db, ct) is { } problem) return problem;
            db.Routines.Add(routine);
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/routines/{routine.Id}", RoutineResponse.From(routine));
        }).Produces<RoutineResponse>(StatusCodes.Status201Created).ProducesValidationProblem();

        g.MapPut("/routines/{id:guid}", async (Guid id, RoutineRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var routine = await db.Routines.Include(r => r.Areas).FirstOrDefaultAsync(r => r.Id == id && r.UserId == uid, ct);
            if (routine is null) return Results.NotFound();
            if (await Apply(routine, req, uid, db, ct) is { } problem) return problem;
            await db.SaveChangesAsync(ct);
            return Results.Ok(RoutineResponse.From(routine));
        }).Produces<RoutineResponse>().ProducesValidationProblem();

        g.MapDelete("/routines/{id:guid}", async (Guid id, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var deleted = await db.Routines.Where(r => r.Id == id && r.UserId == user.UserId()).ExecuteDeleteAsync(ct);
            return deleted == 0 ? Results.NotFound() : Results.NoContent();
        });

        // Everything that already occupies time in a date range, expanded in the account's zone.
        g.MapGet("/commitments", async (DateOnly from, DateOnly to, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (to < from || to.DayNumber - from.DayNumber > BlockEndpoints.MaxRangeDays)
            {
                return HttpExtensions.Invalid("to", $"Ask for a range of at most {BlockEndpoints.MaxRangeDays} days.");
            }
            var uid = user.UserId();
            var occurrences = await db.RoutineOccurrencesAsync(uid, from, to, ct);
            var colors = await db.Routines.AsNoTracking().Where(r => r.UserId == uid).ToDictionaryAsync(r => r.Id, r => r.Color, ct);
            var meetings = await Application.Calendars.CalendarSync.BusyOnAsync(db, uid, from, to, ct);
            return Results.Ok(occurrences
                .Select(o => new CommitmentResponse("routine", o.RoutineId, o.Title, o.Date, o.Start, o.End, o.Minutes, o.Policy, o.AreaIds, o.IsMeal, colors.GetValueOrDefault(o.RoutineId)))
                .Concat(meetings.Select(m => new CommitmentResponse("event", m.ConnectionId, m.Title, m.Date, m.Start, m.End, m.Minutes, TaskPolicy.NoTasks, [], false, null)))
                .OrderBy(c => c.Date).ThenBy(c => c.Start));
        }).Produces<IEnumerable<CommitmentResponse>>();

        g.MapGet("/preferences", async (ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            var uid = user.UserId();
            var u = await db.Users.AsNoTracking().Where(x => x.Id == uid).Select(x => new { x.DayStart, x.DayEnd, x.WaterReminderMinutes, x.BreakColor }).FirstAsync(ct);
            return new PreferencesResponse(u.DayStart ?? DefaultDayStart, u.DayEnd ?? DefaultDayEnd, u.WaterReminderMinutes, u.BreakColor);
        });

        g.MapPut("/preferences", async (PreferencesRequest req, ClaimsPrincipal user, AppDbContext db, CancellationToken ct) =>
        {
            if (req.DayEnd <= req.DayStart) return HttpExtensions.Invalid("dayEnd", "The day has to end after it starts.");
            if (req.DayStart.Minute % 5 != 0 || req.DayEnd.Minute % 5 != 0) return HttpExtensions.Invalid("dayStart", "Use 5-minute steps.");
            if (req.WaterReminderMinutes is { } water && !WaterIntervals.Contains(water)) return HttpExtensions.Invalid("waterReminderMinutes", "Choose every 30, 45, 60, 90 or 120 minutes.");
            if (req.BreakColor is { } breakColor && !AreaColors.All.Contains(breakColor)) return HttpExtensions.Invalid("breakColor", "Pick one of the available colours.");
            var uid = user.UserId();
            var u = await db.Users.FirstAsync(x => x.Id == uid, ct);
            u.DayStart = req.DayStart;
            u.DayEnd = req.DayEnd;
            u.WaterReminderMinutes = req.WaterReminderMinutes;
            u.BreakColor = req.BreakColor;
            await db.SaveChangesAsync(ct);
            return Results.Ok(new PreferencesResponse(req.DayStart, req.DayEnd, req.WaterReminderMinutes, req.BreakColor));
        }).ProducesValidationProblem();
    }

    private static async Task<IResult?> Apply(Routine routine, RoutineRequest req, Guid uid, AppDbContext db, CancellationToken ct)
    {
        if (req.Days == Weekdays.None || (req.Days & ~Weekdays.Everyday) != 0) return HttpExtensions.Invalid("days", "Choose at least one day.");
        if (req.Start == req.End) return HttpExtensions.Invalid("end", "The end must differ from the start.");
        if (req.Start.Minute % 5 != 0 || req.End.Minute % 5 != 0) return HttpExtensions.Invalid("start", "Use 5-minute steps.");
        var areaIds = (req.AreaIds ?? []).Distinct().ToList();
        if (req.Color is { } color && !AreaColors.All.Contains(color)) return HttpExtensions.Invalid("color", "Pick one of the available colours.");
        if (req.TaskPolicy == TaskPolicy.SelectedAreas && areaIds.Count == 0) return HttpExtensions.Invalid("areaIds", "Choose which focus areas may go here.");
        if (await db.FocusAreas.CountAsync(a => a.UserId == uid && areaIds.Contains(a.Id), ct) != areaIds.Count) return HttpExtensions.Invalid("areaIds", "One of the focus areas does not exist.");

        routine.Title = req.Title.Trim();
        routine.Days = req.Days;
        routine.Start = req.Start;
        routine.End = req.End;
        routine.TaskPolicy = req.TaskPolicy;
        routine.IsMeal = req.IsMeal;
        routine.Color = req.Color;
        routine.Areas.Clear();
        if (req.TaskPolicy == TaskPolicy.SelectedAreas) routine.Areas.AddRange(areaIds.Select(a => new RoutineArea { RoutineId = routine.Id, FocusAreaId = a }));
        return null;
    }

    /// <summary>Routine occurrences overlapping the range, including overnight ones that began the day before.</summary>
    public static async Task<IReadOnlyList<RoutineOccurrence>> RoutineOccurrencesAsync(this AppDbContext db, Guid userId, DateOnly from, DateOnly to, CancellationToken ct)
    {
        var routines = await db.Routines.AsNoTracking().Include(r => r.Areas).Where(r => r.UserId == userId).ToListAsync(ct);
        var zoneId = await db.Users.Where(u => u.Id == userId).Select(u => u.TimeZoneId).FirstOrDefaultAsync(ct);
        return RoutineSchedule.Expand(routines.Select(r => r.ToRule()), from, to, TimeZones.Find(zoneId));
    }
}
