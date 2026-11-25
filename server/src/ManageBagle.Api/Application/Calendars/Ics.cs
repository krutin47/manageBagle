using System.Text;
using Ical.Net.CalendarComponents;
using Ical.Net.DataTypes;
using ManageBagle.Api.Data;
using ManageBagle.Api.Domain;

namespace ManageBagle.Api.Application.Calendars;

/// <summary>A busy period read from someone's existing calendar. Only the title and times are kept.</summary>
public sealed record BusyEvent(string Title, DateTimeOffset StartUtc, DateTimeOffset EndUtc);

public static class IcsReader
{
    public const int MaxEvents = 2000;

    /// <summary>
    /// Busy periods between <paramref name="from"/> and <paramref name="to"/>, with recurring events
    /// expanded. Skipped: cancelled events, events marked "free" (transparent), and all-day events
    /// (holidays and birthdays rarely block hours). Times without a zone are read in <paramref name="zone"/>.
    /// </summary>
    public static IReadOnlyList<BusyEvent> Busy(string ics, DateTimeOffset from, DateTimeOffset to, TimeZoneInfo? zone)
    {
        // The text comes from a stranger's server: whatever the parser throws, it means "not a calendar".
        Ical.Net.Calendar? calendar;
        try
        {
            calendar = ics.Contains("BEGIN:VCALENDAR", StringComparison.OrdinalIgnoreCase) ? Ical.Net.Calendar.Load(ics) : null;
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            throw new FormatException("Not an iCalendar file.", e);
        }
        if (calendar is null) throw new FormatException("Not an iCalendar file.");
        var result = new List<BusyEvent>();
        foreach (var occurrence in calendar.GetOccurrences<CalendarEvent>(new CalDateTime(from.UtcDateTime, "UTC"), null))
        {
            var start = Utc(occurrence.Period.StartTime, zone);
            if (start >= to || result.Count >= MaxEvents) break;
            if (occurrence.Source is not CalendarEvent e) continue;
            if (!occurrence.Period.StartTime.HasTime || e.IsAllDay) continue;
            if (string.Equals(e.Status, "CANCELLED", StringComparison.OrdinalIgnoreCase)) continue;
            if (string.Equals(e.Transparency, "TRANSPARENT", StringComparison.OrdinalIgnoreCase)) continue;
            var end = Utc(occurrence.Period.EffectiveEndTime ?? occurrence.Period.StartTime, zone);
            if (end <= from || end <= start) continue;
            var title = string.IsNullOrWhiteSpace(e.Summary) ? "Busy" : e.Summary.Trim();
            result.Add(new BusyEvent(title.Length > 200 ? title[..200] : title, start, end));
        }
        return result;
    }

    private static DateTimeOffset Utc(CalDateTime value, TimeZoneInfo? zone)
    {
        if (!value.IsFloating) return new DateTimeOffset(value.AsUtc, TimeSpan.Zero);
        var local = DateTime.SpecifyKind(value.Value, DateTimeKind.Unspecified);
        return zone is null ? new DateTimeOffset(local, TimeSpan.Zero) : new DateTimeOffset(local, zone.GetUtcOffset(local)).ToUniversalTime();
    }
}

/// <summary>Writes the plan as an iCalendar feed (RFC 5545): titles and times only, never notes.</summary>
public static class IcsWriter
{
    public static string Write(IEnumerable<TimeBlock> blocks, DateTimeOffset now, string calendarName = "manageBagle")
    {
        var sb = new StringBuilder();
        void Line(string text) => Fold(sb, text);
        Line("BEGIN:VCALENDAR");
        Line("VERSION:2.0");
        Line("PRODID:-//manageBagle//Planner//EN");
        Line("CALSCALE:GREGORIAN");
        Line("METHOD:PUBLISH");
        Line($"X-WR-CALNAME:{Escape(calendarName)}");
        Line("X-PUBLISHED-TTL:PT1H");
        foreach (var b in blocks)
        {
            Line("BEGIN:VEVENT");
            Line($"UID:{b.Id}@managebagle");
            Line($"DTSTAMP:{now.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}");
            var (start, end) = Times(b);
            Line(start);
            Line(end);
            Line($"SUMMARY:{Escape(b.Status == ItemStatus.Done ? $"✓ {b.Title}" : b.Title)}");
            if (b.Status == ItemStatus.Skipped) Line("STATUS:CANCELLED");
            Line("TRANSP:OPAQUE");
            Line("END:VEVENT");
        }
        Line("END:VCALENDAR");
        return sb.ToString();
    }

    /// <summary>UTC when the block's zone is known; otherwise "floating" local time, as the plan was written.</summary>
    private static (string Start, string End) Times(TimeBlock b)
    {
        var zone = TimeZones.Find(b.TimeZoneId);
        if (zone is not null && CivilTime.Measure(b.Date, b.Start, b.End, zone) is CivilTime.Span.Ok { StartUtc: { } s, EndUtc: { } e })
        {
            return ($"DTSTART:{s.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}", $"DTEND:{e.UtcDateTime:yyyyMMdd'T'HHmmss'Z'}");
        }
        var startLocal = b.Date.ToDateTime(b.Start);
        var endLocal = startLocal.AddMinutes(b.PlannedMinutes);
        return ($"DTSTART:{startLocal:yyyyMMdd'T'HHmmss}", $"DTEND:{endLocal:yyyyMMdd'T'HHmmss}");
    }

    public static string Escape(string text) =>
        text.Replace(@"\", @"\\").Replace(";", @"\;").Replace(",", @"\,").Replace("\r\n", @"\n").Replace("\n", @"\n").Replace("\r", "");

    /// <summary>Lines longer than 75 octets continue on the next line after a space (RFC 5545 §3.1).</summary>
    private static void Fold(StringBuilder sb, string line)
    {
        var bytes = 0;
        var first = true;
        foreach (var rune in line.EnumerateRunes())
        {
            var size = rune.Utf8SequenceLength;
            if (bytes + size > (first ? 75 : 74))
            {
                sb.Append("\r\n ");
                bytes = 0;
                first = false;
            }
            sb.Append(rune.ToString());
            bytes += size;
        }
        sb.Append("\r\n");
    }
}
