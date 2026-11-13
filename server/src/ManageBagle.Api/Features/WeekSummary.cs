using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

public record WeekTotals(int PlannedMinutes, int LoggedMinutes, int DeepFocusMinutes, int Blocks, int BlocksDone, double? DoneRate);

public record DaySummary(DateOnly Date, int PlannedMinutes, int LoggedMinutes, int DeepFocusMinutes, int Blocks, int BlocksDone, double? DoneRate);

public record AreaSummary(Guid? FocusAreaId, int PlannedMinutes, int LoggedMinutes, double ShareOfPlan);

public record WeekSummaryResponse(DateOnly Start, WeekTotals Totals, IReadOnlyList<DaySummary> Days, IReadOnlyList<AreaSummary> Areas);

/// <summary>The WEEKLY HQ maths: every figure derives from the week's time blocks.</summary>
public static class WeekSummary
{
    public static WeekSummaryResponse Build(DateOnly start, IReadOnlyCollection<TimeBlock> blocks)
    {
        var days = Enumerable.Range(0, 7).Select(offset =>
        {
            var date = start.AddDays(offset);
            var day = blocks.Where(b => b.Date == date).ToList();
            var done = day.Count(b => b.Status == ItemStatus.Done);
            return new DaySummary(date, day.Sum(b => b.PlannedMinutes), Logged(day), Deep(day), day.Count, done, Rate(done, day.Count));
        }).ToList();

        var totalPlanned = blocks.Sum(b => b.PlannedMinutes);
        var totalDone = blocks.Count(b => b.Status == ItemStatus.Done);

        var areas = blocks.GroupBy(b => b.FocusAreaId)
            .Select(grp => new AreaSummary(
                grp.Key,
                grp.Sum(b => b.PlannedMinutes),
                Logged(grp),
                totalPlanned == 0 ? 0 : Math.Round((double)grp.Sum(b => b.PlannedMinutes) / totalPlanned, 4)))
            .OrderByDescending(a => a.PlannedMinutes)
            .ToList();

        return new WeekSummaryResponse(
            start,
            new WeekTotals(totalPlanned, Logged(blocks), Deep(blocks), blocks.Count, totalDone, Rate(totalDone, blocks.Count)),
            days,
            areas);
    }

    // Unrecorded (null) actuals are skipped, not counted as zero.
    private static int Logged(IEnumerable<TimeBlock> blocks) => blocks.Sum(b => b.ActualMinutes ?? 0);

    private static int Deep(IEnumerable<TimeBlock> blocks) => blocks.Where(b => b.WorkMode == WorkMode.DeepFocus).Sum(b => b.PlannedMinutes);

    private static double? Rate(int done, int total) => total == 0 ? null : Math.Round((double)done / total, 4);

    public static void MapSummaryEndpoints(this IEndpointRouteBuilder app)
    {
        app.MapGet("/api/summary/week", async (DateOnly start, ClaimsPrincipal user, AppDbContext db) =>
        {
            var end = start.AddDays(6);
            var blocks = await db.TimeBlocks.AsNoTracking()
                .Where(b => b.UserId == user.UserId() && b.Date >= start && b.Date <= end)
                .ToListAsync();
            return Build(start, blocks);
        }).RequireAuthorization().WithTags("Summary");
    }
}
