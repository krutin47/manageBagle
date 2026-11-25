using Npgsql;

namespace ManageBagle.Api.Infrastructure;

public static class Database
{
    /// <summary>
    /// Applies the instance's connection limit unless the connection string already chooses one.
    /// Npgsql's own default (100) equals PostgreSQL's default max_connections, so a single busy
    /// instance could take every connection and the rest would fail with 53300.
    /// </summary>
    public static string WithPoolLimit(string connectionString, int maxPoolSize)
    {
        var builder = new NpgsqlConnectionStringBuilder(connectionString);
        var explicitlySet = connectionString.Contains("Maximum Pool Size", StringComparison.OrdinalIgnoreCase)
            || connectionString.Contains("MaxPoolSize", StringComparison.OrdinalIgnoreCase);
        if (!explicitlySet) builder.MaxPoolSize = maxPoolSize;
        return builder.ConnectionString;
    }
}
