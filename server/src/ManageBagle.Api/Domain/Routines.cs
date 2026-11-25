namespace ManageBagle.Api.Domain;

/// <summary>Which tasks automatic planning may place inside a routine (P2-C2).</summary>
public enum TaskPolicy
{
    /// <summary>Protected time: lunch, the gym.</summary>
    NoTasks,
    AnyTask,
    /// <summary>Only tasks in the routine's chosen focus areas, e.g. work hours for work tasks.</summary>
    SelectedAreas,
}

[Flags]
public enum Weekdays
{
    None = 0,
    Monday = 1, Tuesday = 2, Wednesday = 4, Thursday = 8, Friday = 16, Saturday = 32, Sunday = 64,
    Workdays = Monday | Tuesday | Wednesday | Thursday | Friday,
    Everyday = Workdays | Saturday | Sunday,
}

/// <summary>A routine as a rule: repeats on <see cref="Days"/>, from <see cref="Start"/> to <see cref="End"/> in civil time.</summary>
public sealed record RoutineRule(Guid Id, string Title, Weekdays Days, TimeOnly Start, TimeOnly End, TaskPolicy Policy, IReadOnlyList<Guid> AreaIds, bool IsMeal);

/// <summary>One day's instance of a routine. <see cref="End"/> may be on the next date (overnight routines).</summary>
public sealed record RoutineOccurrence(Guid RoutineId, string Title, DateOnly Date, TimeOnly Start, TimeOnly End, int Minutes, TaskPolicy Policy, IReadOnlyList<Guid> AreaIds, bool IsMeal)
{
    /// <summary>May a task in this focus area be placed inside this occurrence?</summary>
    public bool Accepts(Guid? focusAreaId) => Policy switch
    {
        TaskPolicy.AnyTask => true,
        TaskPolicy.SelectedAreas => focusAreaId is { } id && AreaIds.Contains(id),
        _ => false,
    };
}

/// <summary>Expands routine rules into occurrences (ADR-014). Pure; the only place this is interpreted.</summary>
public static class RoutineSchedule
{
    public static Weekdays Flag(DayOfWeek day) => day switch
    {
        DayOfWeek.Monday => Weekdays.Monday,
        DayOfWeek.Tuesday => Weekdays.Tuesday,
        DayOfWeek.Wednesday => Weekdays.Wednesday,
        DayOfWeek.Thursday => Weekdays.Thursday,
        DayOfWeek.Friday => Weekdays.Friday,
        DayOfWeek.Saturday => Weekdays.Saturday,
        _ => Weekdays.Sunday,
    };

    /// <summary>
    /// Occurrences that start on dates from <paramref name="from"/> to <paramref name="to"/>, in civil
    /// time: "Mondays 09:00" stays 09:00 across a clock change. A start or end that does not exist
    /// that day (spring forward) moves to the next real time, per ADR-008.
    /// </summary>
    public static IReadOnlyList<RoutineOccurrence> Expand(IEnumerable<RoutineRule> rules, DateOnly from, DateOnly to, TimeZoneInfo? zone)
    {
        var result = new List<RoutineOccurrence>();
        var list = rules.ToList();
        for (var date = from; date <= to; date = date.AddDays(1))
        {
            foreach (var rule in list.Where(r => r.Days.HasFlag(Flag(date.DayOfWeek))))
            {
                var start = Exists(date, rule.Start, zone);
                var endDate = rule.End <= rule.Start ? date.AddDays(1) : date;
                var end = Exists(endDate, rule.End, zone);
                var minutes = CivilTime.Measure(date, start, end, zone) is CivilTime.Span.Ok ok ? ok.Minutes : CivilTime.WallMinutes(start, end);
                result.Add(new RoutineOccurrence(rule.Id, rule.Title, date, start, end, minutes, rule.Policy, rule.AreaIds, rule.IsMeal));
            }
        }
        return result.OrderBy(o => o.Date).ThenBy(o => o.Start).ToList();
    }

    private static TimeOnly Exists(DateOnly date, TimeOnly time, TimeZoneInfo? zone)
    {
        if (zone is null) return time;
        var resolved = CivilTime.Resolve(date, time, zone);
        return resolved.Exists ? time : resolved.NextValidTime!.Value;
    }

    /// <summary>Minutes since midnight of the occurrence's date at which it ends (past 1440 when overnight).</summary>
    public static (int Start, int End) Span(RoutineOccurrence o)
    {
        var start = o.Start.Hour * 60 + o.Start.Minute;
        var end = o.End.Hour * 60 + o.End.Minute;
        return (start, end <= start ? end + 1440 : end);
    }
}

/// <summary>When a recovery break goes relative to the work it belongs to (P2-C4).</summary>
public enum BreakPlacement
{
    After,
    Before,
}
