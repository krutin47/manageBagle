using System.Net.Http.Json;
using ManageBagle.Api.Data;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;

namespace ManageBagle.Api.Tests;

/// <summary>
/// Boots the real API against a throwaway PostgreSQL database. Point MB_TEST_POSTGRES at any server
/// where the user may create databases (defaults to the docker-compose / CI service).
/// </summary>
public class ApiFactory : WebApplicationFactory<Program>, IAsyncLifetime
{
    private readonly string _database = $"managebagle_test_{Guid.NewGuid():N}";

    private string ConnectionString =>
        (Environment.GetEnvironmentVariable("MB_TEST_POSTGRES") ?? "Host=localhost;Port=5432;Username=managebagle;Password=managebagle")
        + $";Database={_database}";

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Default", ConnectionString);
        builder.UseSetting("RateLimits:AuthPerMinute", "10000");
    }

    public Task InitializeAsync() => Task.CompletedTask;

    public new async Task DisposeAsync()
    {
        using (var scope = Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureDeletedAsync();
        }
        await base.DisposeAsync();
    }

    /// <summary>A browser-like client: keeps cookies, talks HTTPS and sends the anti-CSRF header.</summary>
    public HttpClient NewClient(bool withClientHeader = true)
    {
        var client = CreateClient(new WebApplicationFactoryClientOptions
        {
            BaseAddress = new Uri("https://localhost"), AllowAutoRedirect = false, HandleCookies = true,
        });
        if (withClientHeader) client.DefaultRequestHeaders.Add("X-MB-Client", "tests");
        return client;
    }

    public const string Password = "correct horse battery";

    public async Task<(HttpClient Client, string Email)> NewUserAsync()
    {
        var client = NewClient();
        var email = $"user-{Guid.NewGuid():N}@example.com";
        var response = await client.PostAsJsonAsync("/api/auth/register", new { email, password = Password, displayName = "Test User" });
        response.EnsureSuccessStatusCode();
        return (client, email);
    }
}

[CollectionDefinition("api")]
public class ApiCollection : ICollectionFixture<ApiFactory>;
