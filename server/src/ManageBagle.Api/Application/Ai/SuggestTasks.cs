using System.Text.Json;
using ManageBagle.Api.Data;
using Microsoft.EntityFrameworkCore;

namespace ManageBagle.Api.Application.Ai;

/// <summary>What the model returned, before any checking, and what it cost in tokens.</summary>
public sealed record ModelReply(string Json, string Model, int InputTokens, int OutputTokens, bool Refused);

/// <summary>The one call to a language model the app makes (ADR-020). Implemented with the Anthropic SDK; replaced in tests.</summary>
public interface ITaskSuggestionModel
{
    bool Configured { get; }
    Task<ModelReply> SuggestAsync(string instructions, string paragraph, CancellationToken ct);
}

public sealed record AiOptions(string Model, decimal MonthlyBudgetUsd, int DailyLimitPerUser);

public sealed record TaskSuggestion(string Title, int? EstimatedMinutes, WorkMode WorkMode, Guid? FocusAreaId, Priority Impact, DateOnly? DueDate, bool IsOutside);

public sealed record AiStatus(bool Enabled, int RemainingToday);

/// <summary>
/// Use case: turn a paragraph into suggested tasks (P3-AI1). Suggestions only: nothing is saved here;
/// the person reviews them in the brain dump and saves what they keep. Every call is priced and
/// counted against the monthly budget and the person's daily limit.
/// </summary>
public sealed class SuggestTasks(AppDbContext db, ITaskSuggestionModel model, AiOptions options, TimeProvider clock)
{
    public const int MaxLength = 4000;
    public const int MaxTasks = 30;

    /// <summary>US$ per million input and output tokens (Anthropic list prices, 2026-11). Unknown models are priced as the most expensive.</summary>
    private static readonly Dictionary<string, (decimal Input, decimal Output)> Prices = new()
    {
        ["claude-opus-5-5"] = (4m, 20m),
        ["claude-sonnet-5-5"] = (2m, 10m),
        ["claude-haiku-5-5"] = (0.10m, 0.50m),
    };

    public static decimal Cost(string model, int input, int output)
    {
        var (i, o) = Prices.GetValueOrDefault(model, (10m, 50m));
        return (input * i + output * o) / 1_000_000m;
    }

    public async Task<AiStatus> StatusAsync(Guid userId, CancellationToken ct)
    {
        if (!model.Configured) return new AiStatus(false, 0);
        var (usedToday, spent) = await UsageAsync(userId, ct);
        return new AiStatus(spent < options.MonthlyBudgetUsd, Math.Max(0, options.DailyLimitPerUser - usedToday));
    }

    private async Task<(int UsedToday, decimal SpentThisMonth)> UsageAsync(Guid userId, CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var monthStart = new DateTimeOffset(now.Year, now.Month, 1, 0, 0, 0, TimeSpan.Zero);
        var dayStart = new DateTimeOffset(now.UtcDateTime.Date, TimeSpan.Zero);
        var spent = await db.AiUsage.Where(u => u.At >= monthStart).SumAsync(u => u.CostUsd, ct);
        var used = await db.AiUsage.CountAsync(u => u.UserId == userId && u.At >= dayStart, ct);
        return (used, spent);
    }

    public async Task<Result<IReadOnlyList<TaskSuggestion>>> HandleAsync(Guid userId, string text, CancellationToken ct)
    {
        if (!model.Configured) return Failure.Unavailable("ai_off", "Turning text into tasks is not switched on.");
        var paragraph = text.Trim();
        if (paragraph.Length is 0 or > MaxLength) return Failure.Invalid("text", $"Write between 1 and {MaxLength} characters.");

        var (usedToday, spent) = await UsageAsync(userId, ct);
        if (spent >= options.MonthlyBudgetUsd) return Failure.Unavailable("ai_budget_reached", "This month's allowance for turning text into tasks is used up. It comes back on the 1st; you can still add tasks yourself.");
        if (usedToday >= options.DailyLimitPerUser) return Failure.Limited("ai_daily_limit", $"You have used all {options.DailyLimitPerUser} for today. Try again tomorrow.");

        var user = await db.Users.AsNoTracking().Where(u => u.Id == userId).Select(u => new { u.TimeZoneId }).FirstAsync(ct);
        var zone = Domain.TimeZones.Find(user.TimeZoneId) ?? TimeZoneInfo.Utc;
        var today = DateOnly.FromDateTime(TimeZoneInfo.ConvertTime(clock.GetUtcNow(), zone).DateTime);
        var areas = await db.FocusAreas.AsNoTracking().Where(a => a.UserId == userId).OrderBy(a => a.SortOrder).Select(a => new { a.Id, a.Name }).ToListAsync(ct);

        var instructions =
            $"""
            Today is {today:dddd d MMMM yyyy} ({today:yyyy-MM-dd}).
            Turn the person's text into the tasks it contains, one task per thing to do, in the order written.
            - title: a short, specific action, in the person's own language and words; at most 120 characters.
            - estimated_minutes: only if the text says or clearly implies a length; otherwise null.
            - kind: DeepFocus for long concentrated work, Meeting for calls and meetings, Personal for life outside work, otherwise ShallowWork.
            - focus_area: one of these exactly, or null if none fits: {string.Join(", ", areas.Select(a => $"\"{a.Name}\""))}.
            - impact: High only when the text says it matters a lot or is urgent and important; Low for nice-to-haves; otherwise Medium.
            - due_date: YYYY-MM-DD only when the text gives a day ("Friday", "by the 3rd", "tomorrow"); resolve it from today's date; otherwise null.
            - outside: true for errands, travel and appointments away from the desk.
            Do not invent tasks the text does not mention. If the text contains no tasks, return an empty list.
            """;

        var reply = await model.SuggestAsync(instructions, paragraph, ct);
        db.AiUsage.Add(new AiUsage
        {
            UserId = userId, At = clock.GetUtcNow(), Model = reply.Model, InputTokens = reply.InputTokens, OutputTokens = reply.OutputTokens,
            CostUsd = Cost(reply.Model, reply.InputTokens, reply.OutputTokens),
        });
        await db.SaveChangesAsync(ct);
        if (reply.Refused) return Failure.Unavailable("ai_declined", "That text could not be turned into tasks. Add them yourself, line by line.");

        return Parse(reply.Json, today, areas.ToDictionary(a => a.Name, a => a.Id, StringComparer.OrdinalIgnoreCase));
    }

    /// <summary>The model's JSON is checked like any other input: anything malformed is dropped, not trusted.</summary>
    public static List<TaskSuggestion> Parse(string json, DateOnly today, IReadOnlyDictionary<string, Guid> areas)
    {
        var result = new List<TaskSuggestion>();
        JsonElement tasks;
        try
        {
            using var doc = JsonDocument.Parse(json);
            if (!doc.RootElement.TryGetProperty("tasks", out var t) || t.ValueKind != JsonValueKind.Array) return result;
            tasks = t.Clone();
        }
        catch (JsonException)
        {
            return result;
        }

        foreach (var item in tasks.EnumerateArray().Take(MaxTasks))
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            var title = Str(item, "title")?.Trim();
            if (string.IsNullOrEmpty(title)) continue;
            if (title.Length > 200) title = title[..200];

            int? minutes = item.TryGetProperty("estimated_minutes", out var m) && m.ValueKind == JsonValueKind.Number && m.TryGetInt32(out var mm) && mm > 0
                ? Math.Clamp((int)Math.Round(mm / 5.0) * 5, 5, 1440) : null;
            var kind = Enum.TryParse<WorkMode>(Str(item, "kind"), out var k) ? k : WorkMode.ShallowWork;
            var impact = Enum.TryParse<Priority>(Str(item, "impact"), out var p) ? p : Priority.Medium;
            Guid? area = Str(item, "focus_area") is { } name && areas.TryGetValue(name, out var id) ? id : null;
            DateOnly? due = DateOnly.TryParseExact(Str(item, "due_date"), "yyyy-MM-dd", out var d) && d >= today.AddYears(-1) && d <= today.AddYears(2) ? d : null;
            var outside = item.TryGetProperty("outside", out var o) && o.ValueKind == JsonValueKind.True;
            result.Add(new TaskSuggestion(title, minutes, kind, area, impact, due, outside));
        }
        return result;
    }

    private static string? Str(JsonElement e, string name) => e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
}
