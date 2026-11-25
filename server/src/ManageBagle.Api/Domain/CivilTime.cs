namespace ManageBagle.Api.Domain;

/// <summary>
/// The app's single interpretation of wall-clock time (see ADR-008).
///
/// People plan in civil time: "Monday, 09:00–10:30". A civil time only becomes an instant once a time
/// zone is applied, and twice a year that mapping is irregular:
///   - Spring forward: an hour of clock time does not exist. A block may not start or end inside it;
///     the caller is told and offered the next real time.
///   - Fall back: an hour of clock time happens twice. The first occurrence is used.
/// Durations are elapsed minutes between the two instants, so a block across a clock change is as
/// long as it really lasts, not what subtracting the clock faces would suggest.
/// </summary>
public static class CivilTime
{
    public readonly record struct Resolution(DateTimeOffset? Instant, TimeOnly? NextValidTime)
    {
        public bool Exists => Instant is not null;
    }

    public static Resolution Resolve(DateOnly date, TimeOnly time, TimeZoneInfo zone)
    {
        var local = date.ToDateTime(time, DateTimeKind.Unspecified);
        if (zone.IsInvalidTime(local))
        {
            // Walk forward to the first clock time that exists again (gaps are whole or half hours).
            var probe = local;
            do { probe = probe.AddMinutes(5); } while (zone.IsInvalidTime(probe));
            return new Resolution(null, TimeOnly.FromDateTime(probe));
        }
        var offset = zone.IsAmbiguousTime(local)
            ? zone.GetAmbiguousTimeOffsets(local).Max() // the larger offset is the earlier instant: first occurrence
            : zone.GetUtcOffset(local);
        return new Resolution(new DateTimeOffset(local, offset).ToUniversalTime(), null);
    }

    /// <summary>Wall-clock length; an end at or before the start means the block runs past midnight.</summary>
    public static int WallMinutes(TimeOnly start, TimeOnly end) => (int)(end - start).TotalMinutes;

    public abstract record Span
    {
        public sealed record Ok(int Minutes, DateTimeOffset? StartUtc, DateTimeOffset? EndUtc) : Span;

        /// <param name="Field">"start" or "end".</param>
        public sealed record Nonexistent(string Field, TimeOnly Time, DateOnly Date, TimeOnly NextValidTime) : Span;
    }

    /// <summary>
    /// Measures a block. With no zone (legacy rows, or an account that has not chosen one) the wall
    /// clock is all there is; with a zone the result is true elapsed time.
    /// </summary>
    public static Span Measure(DateOnly date, TimeOnly start, TimeOnly end, TimeZoneInfo? zone)
    {
        if (zone is null) return new Span.Ok(WallMinutes(start, end), null, null);

        var endDate = end <= start ? date.AddDays(1) : date;
        var from = Resolve(date, start, zone);
        if (!from.Exists) return new Span.Nonexistent("start", start, date, from.NextValidTime!.Value);
        var to = Resolve(endDate, end, zone);
        if (!to.Exists) return new Span.Nonexistent("end", end, endDate, to.NextValidTime!.Value);

        return new Span.Ok((int)Math.Round((to.Instant!.Value - from.Instant!.Value).TotalMinutes), from.Instant, to.Instant);
    }
}
