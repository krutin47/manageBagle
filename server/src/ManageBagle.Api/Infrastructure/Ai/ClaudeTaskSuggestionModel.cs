using System.Text.Json;
using Anthropic;
using Anthropic.Models.Beta;
using Anthropic.Models.Beta.Messages;
using ManageBagle.Api.Application.Ai;

namespace ManageBagle.Api.Infrastructure.Ai;

/// <summary>
/// The suggestion model, on Claude through the official SDK (ADR-020): structured outputs constrain
/// the reply to the schema below, effort is low (extraction is a simple task), and server-side
/// fallbacks re-serve a request a safety classifier declines.
/// </summary>
public sealed class ClaudeTaskSuggestionModel(IConfiguration config, AiOptions options) : ITaskSuggestionModel
{
    private readonly string? _apiKey = config["Ai:AnthropicApiKey"];
    private AnthropicClient? _client;

    public bool Configured => !string.IsNullOrWhiteSpace(_apiKey);

    private static readonly Dictionary<string, JsonElement> Schema = new()
    {
        ["type"] = JsonSerializer.SerializeToElement("object"),
        ["additionalProperties"] = JsonSerializer.SerializeToElement(false),
        ["required"] = JsonSerializer.SerializeToElement(new[] { "tasks" }),
        ["properties"] = JsonSerializer.SerializeToElement(new
        {
            tasks = new
            {
                type = "array",
                items = new
                {
                    type = "object",
                    additionalProperties = false,
                    required = new[] { "title", "estimated_minutes", "kind", "focus_area", "impact", "due_date", "outside" },
                    properties = new
                    {
                        title = new { type = "string" },
                        estimated_minutes = new { anyOf = new object[] { new { type = "integer" }, new { type = "null" } } },
                        kind = new { type = "string", @enum = new[] { "DeepFocus", "ShallowWork", "Meeting", "Personal" } },
                        focus_area = new { anyOf = new object[] { new { type = "string" }, new { type = "null" } } },
                        impact = new { type = "string", @enum = new[] { "High", "Medium", "Low" } },
                        due_date = new { anyOf = new object[] { new { type = "string" }, new { type = "null" } } },
                        outside = new { type = "boolean" },
                    },
                },
            },
        }),
    };

    public async Task<ModelReply> SuggestAsync(string instructions, string paragraph, CancellationToken ct)
    {
        _client ??= new AnthropicClient { ApiKey = _apiKey };
        var response = await _client.Beta.Messages.Create(new MessageCreateParams
        {
            Model = options.Model,
            MaxTokens = 8000,
            Betas = [AnthropicBeta.ServerSideFallback2026_07_01],
            Fallbacks = new Default(),
            System = instructions,
            OutputConfig = new BetaOutputConfig { Effort = Effort.Low, Format = new BetaJsonOutputFormat { Schema = Schema } },
            Messages = [new BetaUserMessageParam { Content = paragraph }],
        }, ct);

        var json = string.Concat(response.Content.Select(b => b.TryPickText(out var t) ? t.Text : ""));
        return new ModelReply(json, response.Model, (int)response.Usage.InputTokens, (int)response.Usage.OutputTokens, response.StopReason == "refusal");
    }
}
