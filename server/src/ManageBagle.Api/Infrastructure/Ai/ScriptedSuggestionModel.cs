using System.Text.Json;
using ManageBagle.Api.Application.Ai;

namespace ManageBagle.Api.Infrastructure.Ai;

/// <summary>
/// For browser tests only (Testing:ScriptedAi): turns each sentence into a task, with no network and
/// no cost, so the "Write freely" flow can be tested end to end. Never in Production — the app refuses
/// to start if both are set.
/// </summary>
public sealed class ScriptedSuggestionModel : ITaskSuggestionModel
{
    public bool Configured => true;

    public Task<ModelReply> SuggestAsync(string instructions, string paragraph, CancellationToken ct)
    {
        var tasks = paragraph.Split(['.', '\n'], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(sentence => new
            {
                title = sentence, estimated_minutes = (int?)null, kind = sentence.Contains("deck", StringComparison.OrdinalIgnoreCase) ? "DeepFocus" : "ShallowWork",
                focus_area = (string?)null, impact = sentence.Contains("important", StringComparison.OrdinalIgnoreCase) ? "High" : "Medium", due_date = (string?)null,
                outside = sentence.Contains("dentist", StringComparison.OrdinalIgnoreCase),
            });
        return Task.FromResult(new ModelReply(JsonSerializer.Serialize(new { tasks }), "scripted", 0, 0, false));
    }

    public static bool Enabled(IConfiguration config) => config.GetValue("Testing:ScriptedAi", false);
}
