namespace ManageBagle.Api.Domain;

/// <summary>IANA time-zone names ("America/Halifax"), the only form the app stores.</summary>
public static class TimeZones
{
    /// <summary>The canonical id if the name is a zone this system knows; otherwise null.</summary>
    public static string? Normalize(string? id)
    {
        if (string.IsNullOrWhiteSpace(id) || id.Length > 64) return null;
        return TimeZoneInfo.TryFindSystemTimeZoneById(id.Trim(), out var zone) && zone.HasIanaId ? zone.Id : null;
    }

    public static TimeZoneInfo? Find(string? id) =>
        !string.IsNullOrWhiteSpace(id) && TimeZoneInfo.TryFindSystemTimeZoneById(id, out var zone) ? zone : null;
}
