using System.Net;
using ManageBagle.Api.Infrastructure;
using Npgsql;

namespace ManageBagle.Api.Tests;

public sealed class TightLimitFactory : ApiFactory
{
    protected override IEnumerable<(string Key, string Value)> ExtraSettings => [("RateLimits:RequestsPerMinute", "15")];
}

/// <summary>Phase 3: capacity limits found or set by the load test (docs/performance.md).</summary>
public class CapacityTests(TightLimitFactory factory) : IClassFixture<TightLimitFactory>
{
    [Fact]
    public async Task One_account_cannot_take_more_than_its_share_of_requests_and_others_are_unaffected()
    {
        var (greedy, _) = await factory.NewUserAsync();
        var codes = new List<HttpStatusCode>();
        for (var i = 0; i < 20; i++) codes.Add((await greedy.GetAsync("/api/backlog")).StatusCode);
        Assert.Contains(HttpStatusCode.TooManyRequests, codes);

        var (other, _) = await factory.NewUserAsync();
        Assert.Equal(HttpStatusCode.OK, (await other.GetAsync("/api/backlog")).StatusCode);
        // Health checks are never limited: the platform must always be able to ask.
        for (var i = 0; i < 20; i++) Assert.Equal(HttpStatusCode.OK, (await greedy.GetAsync("/health/live")).StatusCode);
    }

    [Theory]
    [InlineData("Host=db;Database=x", 30, 30)]
    [InlineData("Host=db;Database=x;Maximum Pool Size=12", 30, 12)]
    [InlineData("Host=db;Database=x;MaxPoolSize=7", 30, 7)]
    public void Each_instance_takes_a_bounded_share_of_database_connections(string connection, int configured, int expected) =>
        Assert.Equal(expected, new NpgsqlConnectionStringBuilder(Database.WithPoolLimit(connection, configured)).MaxPoolSize);
}
