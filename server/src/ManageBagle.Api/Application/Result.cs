using ManageBagle.Api.Domain;

namespace ManageBagle.Api.Application;

public enum FailureKind
{
    Validation,
    NotFound,
    Conflict,
    /// <summary>A per-person limit was reached; trying later works (HTTP 429).</summary>
    Limited,
    /// <summary>The feature is switched off or paused for everyone (HTTP 503).</summary>
    Unavailable,
}

/// <summary>
/// An expected reason a use case did not happen (ADR-005): invalid input, something missing, a
/// conflict. Unexpected failures are exceptions and are handled once, at the HTTP boundary.
/// </summary>
/// <param name="Code">Stable machine-readable reason, e.g. "stale_version".</param>
/// <param name="Field">For validation failures: the input field the message belongs to.</param>
public sealed record Failure(FailureKind Kind, string Code, string Message, string? Field = null, IReadOnlyDictionary<string, object?>? Extra = null)
{
    public static Failure Invalid(string field, string message, string code = "validation_failed") => new(FailureKind.Validation, code, message, field);

    public static Failure NotFound(string message = "We could not find that. It may have been deleted.") => new(FailureKind.NotFound, "not_found", message);

    public static Failure Conflict(string code, string message) => new(FailureKind.Conflict, code, message);

    public static Failure Limited(string code, string message) => new(FailureKind.Limited, code, message);

    public static Failure Unavailable(string code, string message) => new(FailureKind.Unavailable, code, message);

    public static Failure NonexistentTime(CivilTime.Span.Nonexistent gap) => new(
        FailureKind.Validation, "nonexistent_local_time",
        $"{gap.Time:HH\\:mm} does not exist on {gap.Date:d MMMM}: the clocks go forward that day. The next time that exists is {gap.NextValidTime:HH\\:mm}.",
        gap.Field,
        new Dictionary<string, object?> { ["nextValidTime"] = gap.NextValidTime.ToString("HH\\:mm") });
}

/// <summary>The outcome of a use case: a value, or the expected <see cref="Failure"/> that stopped it.</summary>
public readonly struct Result<T>
{
    private Result(T? value, Failure? failure)
    {
        Value = value;
        Failure = failure;
    }

    public T? Value { get; }
    public Failure? Failure { get; }
    public bool Succeeded => Failure is null;

    public static implicit operator Result<T>(T value) => new(value, null);
    public static implicit operator Result<T>(Failure failure) => new(default, failure);
}
