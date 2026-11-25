using ManageBagle.Api.Application;

namespace ManageBagle.Api.Infrastructure;

/// <summary>Turns use-case outcomes into HTTP responses. The only place that knows this mapping.</summary>
public static class ResultHttp
{
    public static IResult ToHttp<T>(this Result<T> result, Func<T, IResult> onSuccess) =>
        result.Succeeded ? onSuccess(result.Value!) : result.Failure!.ToHttp();

    public static IResult ToHttp(this Failure failure)
    {
        if (failure.Kind != FailureKind.Validation)
        {
            var status = failure.Kind == FailureKind.NotFound ? StatusCodes.Status404NotFound : StatusCodes.Status409Conflict;
            return HttpExtensions.Problem(status, failure.Code, failure.Message);
        }
        var extensions = new Dictionary<string, object?>(failure.Extra ?? new Dictionary<string, object?>()) { ["code"] = failure.Code };
        return Results.ValidationProblem(new Dictionary<string, string[]> { [failure.Field ?? "form"] = [failure.Message] }, extensions: extensions);
    }
}
