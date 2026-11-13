namespace ManageBagle.Api.Data;

/// <summary>Starting system every new account gets. Everything here is editable afterwards.</summary>
public static class DefaultData
{
    private static readonly (string Name, string Color)[] Areas =
    [
        ("Build / Deep work", "teal"),
        ("Career / Job search", "blue"),
        ("Creator / Content", "violet"),
        ("Wedding / Personal", "rose"),
        ("Health / Movement", "green"),
        ("Home / Admin", "slate"),
        ("Relationships / Fun", "orange"),
        ("Rest / Recovery", "amber"),
    ];

    private static readonly (DayOfWeek Day, string Focus, string Outcome)[] Themes =
    [
        (DayOfWeek.Monday, "Build / deep work", "Finish one project milestone"),
        (DayOfWeek.Tuesday, "Career & execution", "Complete targeted applications"),
        (DayOfWeek.Wednesday, "Build / deep work", "Test or ship a small feature"),
        (DayOfWeek.Thursday, "Content & strategy", "Create a batch of quality content"),
        (DayOfWeek.Friday, "Admin & wrap-up", "Clear decisions and review progress"),
        (DayOfWeek.Saturday, "People & experiences", "Uninterrupted social / personal time"),
        (DayOfWeek.Sunday, "Rest & reset", "Recover and plan next week's Big 3"),
    ];

    public static void AddFor(AppDbContext db, Guid userId)
    {
        db.FocusAreas.AddRange(Areas.Select((a, i) => new FocusArea
        {
            UserId = userId, Name = a.Name, Color = a.Color, SortOrder = i,
        }));
        db.DayThemes.AddRange(Themes.Select(t => new DayTheme
        {
            UserId = userId, Day = t.Day, PrimaryFocus = t.Focus, Outcome = t.Outcome,
        }));
    }
}
