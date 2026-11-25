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
    /// <summary>When the owner confirmed by email that they lost every second factor; null when no reset is pending.</summary>
    public DateTimeOffset? MfaResetConfirmedAt { get; set; }
    /// <summary>When a confirmed reset may be completed. The wait gives the real owner time to cancel.</summary>
    public DateTimeOffset? MfaResetAvailableAt { get; set; }
    /// <summary>The part of the day automatic planning may use (P2-C3). Null means the default, 08:00–21:00.</summary>
    public TimeOnly? DayStart { get; set; }
    public TimeOnly? DayEnd { get; set; }
    /// <summary>Minutes between "drink water" reminders; null when switched off (P2-C5).</summary>
    public int? WaterReminderMinutes { get; set; }
    /// <summary>Colour of recovery breaks on the calendar, one of <see cref="AreaColors.All"/>; null is the default green.</summary>
    public string? BreakColor { get; set; }
    /// <summary>Calendar feed (P2-D1): the secret part of the subscription address, encrypted, and its hash for lookup.</summary>
    public string? CalendarFeedTokenProtected { get; set; }
    public string? CalendarFeedTokenHash { get; set; }
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
    /// <summary>Recovery break reserved next to each task in this area, in minutes (0 = none).</summary>
    public int BreakMinutes { get; set; }
    public Domain.BreakPlacement BreakPlacement { get; set; } = Domain.BreakPlacement.After;
}

/// <summary>A daily routine, stored as a rule and expanded on read (ADR-014).</summary>
public class Routine
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Title { get; set; } = "";
    public Domain.Weekdays Days { get; set; } = Domain.Weekdays.Workdays;
    public TimeOnly Start { get; set; }
    public TimeOnly End { get; set; }
    public Domain.TaskPolicy TaskPolicy { get; set; } = Domain.TaskPolicy.NoTasks;
    public bool IsMeal { get; set; }
    /// <summary>One of <see cref="AreaColors.All"/>; null shows the neutral default.</summary>
    public string? Color { get; set; }
    public List<RoutineArea> Areas { get; set; } = [];

    public Domain.RoutineRule ToRule() => new(Id, Title, Days, Start, End, TaskPolicy, Areas.Select(a => a.FocusAreaId).ToList(), IsMeal);
}

public class RoutineArea
{
    public Guid RoutineId { get; set; }
    public Guid FocusAreaId { get; set; }
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

/// <summary>A security-relevant account event, kept so the owner can see it and support can investigate.</summary>
public class AuditEvent
{
    public long Id { get; set; }
    public Guid UserId { get; set; }
    /// <summary>Stable snake_case name, e.g. "sign_in", "mfa_disabled".</summary>
    public string Event { get; set; } = "";
    /// <summary>Short non-secret detail such as a provider name. Never credentials, codes or tokens.</summary>
    public string Detail { get; set; } = "";
    public DateTimeOffset At { get; set; }
}

/// <summary>An existing calendar read for busy time (P2-D2). The address is a secret and is stored encrypted.</summary>
public class CalendarConnection
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string Name { get; set; } = "";
    public string UrlProtected { get; set; } = "";
    /// <summary>Host only, for display: "calendar.google.com".</summary>
    public string Host { get; set; } = "";
    public DateTimeOffset? LastFetchedAt { get; set; }
    public string LastError { get; set; } = "";
    public int EventCount { get; set; }
    public List<ExternalEvent> Events { get; set; } = [];
}

public class ExternalEvent
{
    public long Id { get; set; }
    public Guid ConnectionId { get; set; }
    public Guid UserId { get; set; }
    public string Title { get; set; } = "";
    public DateTimeOffset StartUtc { get; set; }
    public DateTimeOffset EndUtc { get; set; }
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

    // ---- Focus timer (ADR-013) ----
    /// <summary>When the current run began (UTC); null when the timer is not running.</summary>
    public DateTimeOffset? TimerStartedAt { get; set; }
    /// <summary>Seconds accumulated by earlier runs.</summary>
    public int TrackedSeconds { get; set; }
    /// <summary>Extra minutes granted at "time's up". The plan itself is not changed.</summary>
    public int ExtendedMinutes { get; set; }
    /// <summary>When work on the block first started, and when it was finished (UTC instants).</summary>
    public DateTimeOffset? FirstStartedAt { get; set; }
    public DateTimeOffset? FinishedAt { get; set; }
    /// <summary>Recovery break reserved before / after the block (P2-C4). Not counted as planned work.</summary>
    public int BreakBeforeMinutes { get; set; }
    public int BreakAfterMinutes { get; set; }
    /// <summary>Optional note left when the block was put off or dropped.</summary>
    public string StopNote { get; set; } = "";

    public bool TimerRunning => TimerStartedAt is not null;

    public void StartTimer(DateTimeOffset now)
    {
        if (TimerRunning) return;
        TimerStartedAt = now;
        FirstStartedAt ??= now;
        if (Status == ItemStatus.Planned) Status = ItemStatus.InProgress;
    }

    /// <summary>Banks the current run and records the time worked as the actual minutes.</summary>
    public void PauseTimer(DateTimeOffset now)
    {
        if (!TimerRunning) return;
        TrackedSeconds = Domain.FocusTime.Elapsed(TrackedSeconds, TimerStartedAt, now);
        TimerStartedAt = null;
        ActualMinutes = Domain.FocusTime.ActualMinutes(TrackedSeconds) ?? ActualMinutes;
    }

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
    /// <summary>Recovery break for this task; null follows its focus area.</summary>
    public int? BreakMinutes { get; set; }
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
