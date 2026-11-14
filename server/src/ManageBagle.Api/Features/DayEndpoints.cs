using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Data;
using ManageBagle.Api.Infrastructure;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Features;

public record OutcomeRequest(
    [Required, StringLength(200, MinimumLength = 1)] string Result,
    Guid? FocusAreaId,
    [StringLength(200)] string? NextAction,
    ItemStatus Status,
    [Range(5, 1440)] int? MinutesNeeded);

public record OutcomeResponse(int Rank, string Result, Guid? FocusAreaId, string NextAction, ItemStatus Status, int? MinutesNeeded, Guid? BacklogTaskId);

public record ReviewRequest([StringLength(1000)] string? BiggestWin, [StringLength(1000)] string? Interruptions, [StringLength(1000)] string? ChangeTomorrow);

public record ReviewResponse(string BiggestWin, string Interruptions, string ChangeTomorrow);

public record DayResponse(DateOnly Date, IEnumerable<OutcomeResponse> Outcomes, ReviewResponse Review);

public record ThemeRequest([StringLength(80)] string? PrimaryFocus, [StringLength(200)] string? Outcome, [StringLength(500)] string? Review);

public record ThemeResponse(DayOfWeek Day, string PrimaryFocus, string Outcome, string Review);

public static class DayEndpoints
{
    public static void MapDayEndpoints(this IEndpointRouteBuilder app)
    {
        var g = app.MapGroup("/api/days/{date}").RequireAuthorization().WithTags("Daily focus");

        g.MapGet("", async (DateOnly date, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            var outcomes = await db.DailyOutcomes.AsNoTracking().Where(o => o.UserId == uid && o.Date == date).OrderBy(o => o.Rank).ToListAsync();
            var review = await db.DailyReviews.AsNoTracking().FirstOrDefaultAsync(r => r.UserId == uid && r.Date == date);
            return new DayResponse(date, outcomes.Select(ToResponse),
                new ReviewResponse(review?.BiggestWin ?? "", review?.Interruptions ?? "", review?.ChangeTomorrow ?? ""));
        });

        g.MapPut("/outcomes/{rank:int}", async (DateOnly date, int rank, OutcomeRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (rank is < 1 or > 3) return HttpExtensions.Invalid("rank", "A day has three outcomes: rank 1, 2 or 3.");
            var uid = user.UserId();
            if (!await db.OwnsAreaAsync(uid, req.FocusAreaId)) return HttpExtensions.Invalid("focusAreaId", "That focus area does not exist.");

            var outcome = await db.DailyOutcomes.FirstOrDefaultAsync(o => o.UserId == uid && o.Date == date && o.Rank == rank);
            if (outcome is null)
            {
                outcome = new DailyOutcome { UserId = uid, Date = date, Rank = rank };
                db.DailyOutcomes.Add(outcome);
            }
            outcome.Result = req.Result.Trim();
            outcome.FocusAreaId = req.FocusAreaId;
            outcome.NextAction = req.NextAction?.Trim() ?? "";
            outcome.Status = req.Status;
            outcome.MinutesNeeded = req.MinutesNeeded;

            // An outcome that came from a planned task carries that day's blocks and the task with it.
            if (outcome.BacklogTaskId is { } taskId && req.Status == ItemStatus.Done)
            {
                var task = await db.BacklogTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.UserId == uid);
                if (task is not null) task.Status = ItemStatus.Done;
                var blocks = await db.TimeBlocks.Where(b => b.UserId == uid && b.Date == date && b.BacklogTaskId == taskId).ToListAsync();
                foreach (var block in blocks)
                {
                    block.Status = ItemStatus.Done;
                    block.ActualMinutes ??= block.PlannedMinutes;
                }
            }
            await db.SaveChangesAsync();
            return Results.Ok(ToResponse(outcome));
        });

        g.MapDelete("/outcomes/{rank:int}", async (DateOnly date, int rank, ClaimsPrincipal user, AppDbContext db) =>
        {
            await db.DailyOutcomes.Where(o => o.UserId == user.UserId() && o.Date == date && o.Rank == rank).ExecuteDeleteAsync();
            return Results.NoContent();
        });

        g.MapPut("/review", async (DateOnly date, ReviewRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            var uid = user.UserId();
            var review = await db.DailyReviews.FirstOrDefaultAsync(r => r.UserId == uid && r.Date == date);
            if (review is null)
            {
                review = new DailyReview { UserId = uid, Date = date };
                db.DailyReviews.Add(review);
            }
            review.BiggestWin = req.BiggestWin?.Trim() ?? "";
            review.Interruptions = req.Interruptions?.Trim() ?? "";
            review.ChangeTomorrow = req.ChangeTomorrow?.Trim() ?? "";
            await db.SaveChangesAsync();
            return new ReviewResponse(review.BiggestWin, review.Interruptions, review.ChangeTomorrow);
        });

        var themes = app.MapGroup("/api/themes").RequireAuthorization().WithTags("Day themes");

        themes.MapGet("", async (ClaimsPrincipal user, AppDbContext db) =>
        {
            var saved = await db.DayThemes.AsNoTracking().Where(t => t.UserId == user.UserId()).ToListAsync();
            return WeekOrder.Select(day => saved.FirstOrDefault(t => t.Day == day) is { } t
                ? new ThemeResponse(day, t.PrimaryFocus, t.Outcome, t.Review)
                : new ThemeResponse(day, "", "", ""));
        });

        themes.MapPut("/{day}", async (DayOfWeek day, ThemeRequest req, ClaimsPrincipal user, AppDbContext db) =>
        {
            if (!Enum.IsDefined(day)) return Results.NotFound();
            var uid = user.UserId();
            var theme = await db.DayThemes.FirstOrDefaultAsync(t => t.UserId == uid && t.Day == day);
            if (theme is null)
            {
                theme = new DayTheme { UserId = uid, Day = day };
                db.DayThemes.Add(theme);
            }
            theme.PrimaryFocus = req.PrimaryFocus?.Trim() ?? "";
            theme.Outcome = req.Outcome?.Trim() ?? "";
            theme.Review = req.Review?.Trim() ?? "";
            await db.SaveChangesAsync();
            return Results.Ok(new ThemeResponse(day, theme.PrimaryFocus, theme.Outcome, theme.Review));
        });
    }

    private static readonly DayOfWeek[] WeekOrder =
    [
        DayOfWeek.Monday, DayOfWeek.Tuesday, DayOfWeek.Wednesday, DayOfWeek.Thursday,
        DayOfWeek.Friday, DayOfWeek.Saturday, DayOfWeek.Sunday,
    ];

    internal static OutcomeResponse ToResponse(DailyOutcome o) => new(o.Rank, o.Result, o.FocusAreaId, o.NextAction, o.Status, o.MinutesNeeded, o.BacklogTaskId);
}
