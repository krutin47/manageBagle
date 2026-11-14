using Microsoft.AspNetCore.Identity;

namespace ManageBagle.Api.Data;

public enum Priority { High, Medium, Low }

public enum WorkMode { DeepFocus, ShallowWork, Meeting, Personal }

public enum ItemStatus { Planned, InProgress, Done, Skipped }

public class AppUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = "";
    /// <summary>IANA zone the person plans in. Null until first set (accounts created before the setting existed).</summary>
    public string? TimeZoneId { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public class FocusArea
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    /// <summary>Key into the client's categorical palette (see <see cref="AreaColors"/>).</summary>
    public string Color { get; set; } = "teal";
    public int SortOrder { get; set; }
}

public static class AreaColors
{
    public static readonly string[] All = ["teal", "blue", "violet", "rose", "orange", "amber", "green", "slate"];
}

/// <summary>Rows that are edited by people and so carry a version for optimistic concurrency.</summary>
public interface IVersioned
{
    int Version { get; set; }
}

public class IdempotencyRecord
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Key { get; set; } = "";
    public string RequestHash { get; set; } = "";
    public string ResponseJson { get; set; } = "";
    public DateTimeOffset ExpiresAt { get; set; }
}

public class TimeBlock : IVersioned
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public DateOnly Date { get; set; }
    public TimeOnly Start { get; set; }
    public TimeOnly End { get; set; }
    public string Title { get; set; } = "";
    public Guid? FocusAreaId { get; set; }
    public FocusArea? FocusArea { get; set; }
    public Priority Priority { get; set; } = Priority.Medium;
    public WorkMode WorkMode { get; set; } = WorkMode.DeepFocus;
    public ItemStatus Status { get; set; } = ItemStatus.Planned;
    /// <summary>Null means "not recorded yet", never zero minutes worked.</summary>
    public int? ActualMinutes { get; set; }
    public string Notes { get; set; } = "";
    /// <summary>Happens out in the physical world (errands, travel, appointments), so it may overrun.</summary>
    public bool IsOutside { get; set; }
    public Guid? BacklogTaskId { get; set; }
    public BacklogTask? BacklogTask { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    /// <summary>The zone the block was planned in. It stays anchored there if the person later travels. Null on rows from before zones existed.</summary>
    public string? TimeZoneId { get; set; }
    /// <summary>Elapsed length, fixed when the block is scheduled (see <see cref="Domain.CivilTime"/>).</summary>
    public int PlannedMinutes { get; set; }
    public int Version { get; set; } = 1;

    /// <summary>Sets when the block happens. Returns the problem instead if a clock time does not exist that day.</summary>
    public Domain.CivilTime.Span.Nonexistent? Schedule(DateOnly date, TimeOnly start, TimeOnly end, string? timeZoneId)
    {
        var span = Domain.CivilTime.Measure(date, start, end, Domain.TimeZones.Find(timeZoneId));
        if (span is Domain.CivilTime.Span.Nonexistent gap) return gap;
        Date = date;
        Start = start;
        End = end;
        TimeZoneId = timeZoneId;
        PlannedMinutes = ((Domain.CivilTime.Span.Ok)span).Minutes;
        return null;
    }
}

public class BacklogTask : IVersioned
{
    public int Version { get; set; } = 1;
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Title { get; set; } = "";
    public Guid? FocusAreaId { get; set; }
    public FocusArea? FocusArea { get; set; }
    public int? EstimatedMinutes { get; set; }
    public Priority Priority { get; set; } = Priority.Medium;
    public DateOnly? DueDate { get; set; }
    public ItemStatus Status { get; set; } = ItemStatus.Planned;
    public string NextStep { get; set; } = "";
    public WorkMode WorkMode { get; set; } = WorkMode.DeepFocus;
    public bool IsOutside { get; set; }
    /// <summary>How much finishing this moves things forward. Priority is urgency; impact is value.</summary>
    public Priority Impact { get; set; } = Priority.Medium;
    public DateOnly? ScheduledDate { get; set; }
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

/// <summary>One of the day's "big three" outcomes.</summary>
public class DailyOutcome
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public DateOnly Date { get; set; }
    public int Rank { get; set; }
    public string Result { get; set; } = "";
    public Guid? FocusAreaId { get; set; }
    public FocusArea? FocusArea { get; set; }
    public string NextAction { get; set; } = "";
    public ItemStatus Status { get; set; } = ItemStatus.Planned;
    public int? MinutesNeeded { get; set; }
    /// <summary>Set when the outcome came from a planned task, so finishing one finishes the other.</summary>
    public Guid? BacklogTaskId { get; set; }
    public BacklogTask? BacklogTask { get; set; }
}

public class DailyReview
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public DateOnly Date { get; set; }
    public string BiggestWin { get; set; } = "";
    public string Interruptions { get; set; } = "";
    public string ChangeTomorrow { get; set; } = "";
}

public class DayTheme
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public DayOfWeek Day { get; set; }
    public string PrimaryFocus { get; set; } = "";
    public string Outcome { get; set; } = "";
    public string Review { get; set; } = "";
}
