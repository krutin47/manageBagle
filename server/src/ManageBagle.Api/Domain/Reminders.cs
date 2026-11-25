namespace ManageBagle.Api.Domain;

/// <summary>A person's reminder settings for one day, in minutes from midnight in their zone.</summary>
public sealed record ReminderPlan(int DayStart, int DayEnd, int? WaterEvery, IReadOnlyList<(string Title, int Start)> Meals);

public sealed record DueReminder(string Key, string Kind, int At, string Title, string Body);

/// <summary>
/// Which reminders fall in a window (P2-C5). The same rule as the in-app reminders
/// (client/src/lib/reminders.ts), so a notification and a toast never disagree: water every N minutes
/// from the start of the day, inside the day window; a meal reminder when a meal routine starts.
/// </summary>
public static class ReminderSchedule
{
    /// <summary>Reminders due in the half-open window (after, upTo].</summary>
    public static IReadOnlyList<DueReminder> Between(int after, int upTo, ReminderPlan plan)
    {
        var due = new List<DueReminder>();
        if (plan.WaterEvery is > 0 and var every)
        {
            for (var at = plan.DayStart + every; at < plan.DayEnd; at += every)
            {
                if (at > after && at <= upTo) due.Add(new($"water-{at}", "water", at, "Time for some water", "A glass of water now keeps the afternoon slump away."));
            }
        }
        foreach (var (title, start) in plan.Meals)
        {
            if (start > after && start <= upTo) due.Add(new($"meal-{start}-{title}", "meal", start, $"{title} time", "Step away from the screen. The plan will wait."));
        }
        return due.OrderBy(d => d.At).ToList();
    }
}
