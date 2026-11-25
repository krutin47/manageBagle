using System.ComponentModel.DataAnnotations;
using System.Security.Claims;
using ManageBagle.Api.Application.Planning;
using ManageBagle.Api.Infrastructure;
using Microsoft.AspNetCore.Mvc;

namespace ManageBagle.Api.Features;

public record PlanRequest([Required, MinLength(1), MaxLength(40)] PlanItem[] Items);

public static class PlanEndpoints
{
    public static void MapPlanEndpoints(this IEndpointRouteBuilder app)
    {
        // Thin by design: read the request, run the use case, translate the outcome.
        app.MapPost("/api/days/{date}/plan", async (DateOnly date, PlanRequest req, [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
                ClaimsPrincipal user, PlanDay planDay, CancellationToken ct) =>
            (await planDay.HandleAsync(new PlanDay.Command(user.UserId(), date, req.Items, idempotencyKey), ct)).ToHttp(Results.Ok))
            .RequireAuthorization().WithTags("Daily focus")
            .Produces<PlanResponse>().ProducesValidationProblem().ProducesProblem(StatusCodes.Status409Conflict);
    }
}
