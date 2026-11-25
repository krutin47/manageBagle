using Microsoft.AspNetCore.Http.Metadata;
using Microsoft.AspNetCore.Routing;
using Microsoft.Extensions.DependencyInjection;

namespace ManageBagle.Api.Tests;

/// <summary>Handbook Phase 2, "per-endpoint metadata": every API route says what it returns on success.</summary>
public class EndpointMetadataTests(ApiFactory factory) : IClassFixture<ApiFactory>
{
    [Fact]
    public void Every_api_endpoint_declares_its_success_response()
    {
        _ = factory.CreateClient(); // builds the app
        var endpoints = factory.Services.GetRequiredService<EndpointDataSource>().Endpoints.OfType<RouteEndpoint>()
            .Where(e => e.RoutePattern.RawText?.StartsWith("/api") == true)
            // Not API operations: the contract document itself, and the catch-all that answers 404.
            .Where(e => e.RoutePattern.RawText is not ("/api/openapi.json" or "/api/{**path}"));
        var missing =
            from e in endpoints
            let produces = e.Metadata.OfType<IProducesResponseTypeMetadata>().ToList()
            where !produces.Any(p => p.StatusCode is >= 200 and < 400)
            let methods = e.Metadata.GetMetadata<HttpMethodMetadata>()?.HttpMethods ?? []
            select $"{string.Join(",", methods)} {e.RoutePattern.RawText}";
        var list = missing.ToList();
        Assert.True(list.Count == 0, $"{list.Count} endpoints without a declared success response:\n" + string.Join("\n", list));
    }
}
