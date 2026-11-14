using Microsoft.AspNetCore.Identity;

namespace ManageBagle.Api.Data;

public enum Priority { High, Medium, Low }

public enum WorkMode { DeepFocus, ShallowWork, Meeting, Personal }

public enum ItemStatus { Planned, InProgress, Done, Skipped }

public class AppUser : IdentityUser<Guid>
{
    public string DisplayName { get; set; } = "";
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

public class TimeBlock
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

    /// <summary>An end earlier than the start means the block runs past midnight.</summary>
    public int PlannedMinutes => PlannedMinutesBetween(Start, End);

    public static int PlannedMinutesBetween(TimeOnly start, TimeOnly end)
    {
        var diff = (int)(end - start).TotalMinutes; // TimeOnly subtraction already wraps past midnight
        return diff;
    }
}

public class BacklogTask
{
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
