namespace ManageBagle.Api.Domain;

/// <summary>Arithmetic for the focus timer (ADR-013). Instants are UTC; nothing ticks on the server.</summary>
public static class FocusTime
{
    /// <summary>Seconds worked so far: earlier runs plus the current one, if running.</summary>
    public static int Elapsed(int trackedSeconds, DateTimeOffset? runningSince, DateTimeOffset now) =>
        trackedSeconds + (runningSince is { } since ? Math.Max(0, (int)(now - since).TotalSeconds) : 0);

    /// <summary>
    /// Minutes recorded as "actual". Rounded to the nearest minute; any real work (30 s or more) counts
    /// as at least one minute, and a few accidental seconds count as none.
    /// </summary>
    public static int? ActualMinutes(int trackedSeconds) =>
        trackedSeconds < 30 ? null : Math.Max(1, (int)Math.Round(trackedSeconds / 60.0, MidpointRounding.AwayFromZero));

    /// <summary>When "time's up" is due: the planned length plus any extension already granted.</summary>
    public static int DueSeconds(int plannedMinutes, int extendedMinutes) => (plannedMinutes + extendedMinutes) * 60;
}

/// <summary>How a person ends a timed block (P2-B5).</summary>
public enum StopOutcome
{
    /// <summary>Done; the time worked is the actual time.</summary>
    Finished,
    /// <summary>Not finished; the task goes back to the backlog, unscheduled.</summary>
    Later,
    /// <summary>Not going to happen; the block and its task are dropped, optionally with a note.</summary>
    Drop,
}
