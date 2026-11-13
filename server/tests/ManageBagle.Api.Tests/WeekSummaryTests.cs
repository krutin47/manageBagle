using ManageBagle.Api.Data;
using ManageBagle.Api.Features;

namespace ManageBagle.Api.Tests;

public class WeekSummaryTests
{
    private static readonly DateOnly Monday = new(2026, 11, 16);

    private static TimeBlock Block(int dayOffset, string start, string end, WorkMode mode = WorkMode.DeepFocus,
        ItemStatus status = ItemStatus.Planned, int? actual = null, Guid? area = null) => new()
    {
        Date = Monday.AddDays(dayOffset), Start = TimeOnly.Parse(start), End = TimeOnly.Parse(end),
        WorkMode = mode, Status = status, ActualMinutes = actual, FocusAreaId = area, Title = "t",
    };

    [Theory]
    [InlineData("09:00", "10:30", 90)]
    [InlineData("11:00", "11:45", 45)]
    [InlineData("23:30", "00:15", 45)] // runs past midnight, like MOD(end-start,1) in the workbook
    [InlineData("22:00", "06:00", 480)]
    public void Planned_minutes_wrap_past_midnight(string start, string end, int expected) =>
        Assert.Equal(expected, TimeBlock.PlannedMinutesBetween(TimeOnly.Parse(start), TimeOnly.Parse(end)));

    [Fact]
    public void Totals_match_the_workbook_formulas()
    {
        var build = Guid.NewGuid();
        var health = Guid.NewGuid();
        var summary = WeekSummary.Build(Monday,
        [
            Block(0, "09:00", "10:30", WorkMode.DeepFocus, ItemStatus.Done, actual: 100, area: build),
            Block(0, "11:00", "11:45", WorkMode.ShallowWork, ItemStatus.Planned, area: build),
            Block(0, "18:00", "18:30", WorkMode.Personal, ItemStatus.Skipped, area: health),
            Block(1, "10:00", "11:00", WorkMode.DeepFocus, ItemStatus.Done, actual: 50),
        ]);

        Assert.Equal(225, summary.Totals.PlannedMinutes);
        Assert.Equal(150, summary.Totals.LoggedMinutes); // blanks are "not recorded", not zero
        Assert.Equal(150, summary.Totals.DeepFocusMinutes);
        Assert.Equal(0.5, summary.Totals.DoneRate);

        Assert.Equal(7, summary.Days.Count);
        Assert.Equal(165, summary.Days[0].PlannedMinutes);
        Assert.Equal(3, summary.Days[0].Blocks);
        Assert.Equal(0.3333, summary.Days[0].DoneRate);
        Assert.Null(summary.Days[2].DoneRate); // nothing planned: no rate rather than 0%

        var buildArea = summary.Areas.Single(a => a.FocusAreaId == build);
        Assert.Equal(135, buildArea.PlannedMinutes);
        Assert.Equal(0.6, buildArea.ShareOfPlan);
        Assert.Equal(1, summary.Areas.Sum(a => a.ShareOfPlan), 3);
    }

    [Fact]
    public void Empty_week_has_no_done_rate()
    {
        var summary = WeekSummary.Build(Monday, []);
        Assert.Equal(0, summary.Totals.PlannedMinutes);
        Assert.Null(summary.Totals.DoneRate);
        Assert.Empty(summary.Areas);
    }
}
