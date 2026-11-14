using Npgsql;
using Testcontainers.PostgreSql;

namespace TicketService.Tests.Support;

/// <summary>
/// Throwaway Postgres bootstrapped like packages/testing: the real role/schema init script, then
/// the ticket service's SQL migrations as tickets_owner. Roles all use <see cref="TestPassword"/>.
/// </summary>
public sealed class PostgresFixture : IAsyncLifetime
{
    public const string TestPassword = "test-password";
    private const string Database = "eticketing";

    private static readonly string RepoRoot = FindRepoRoot();

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder("postgres:18-alpine")
        .WithDatabase(Database)
        .WithUsername("postgres")
        .WithPassword(TestPassword)
        .WithEnvironment("TICKETS_OWNER_PASSWORD", TestPassword)
        .WithEnvironment("TICKETS_APP_PASSWORD", TestPassword)
        .WithEnvironment("PAYMENTS_OWNER_PASSWORD", TestPassword)
        .WithEnvironment("PAYMENTS_APP_PASSWORD", TestPassword)
        .WithEnvironment("LEDGER_OWNER_PASSWORD", TestPassword)
        .WithEnvironment("LEDGER_APP_PASSWORD", TestPassword)
        .WithResourceMapping(
            File.ReadAllBytes(Path.Combine(RepoRoot, "infra/postgres/init/00-roles.sh")),
            "/docker-entrypoint-initdb.d/00-roles.sh",
            0b111_101_101u /* rwxr-xr-x */)
        .Build();

    public async Task InitializeAsync()
    {
        await _container.StartAsync();

        var migrations = Directory
            .GetDirectories(Path.Combine(RepoRoot, "apps/ticket-service/prisma/migrations"))
            .OrderBy(dir => Path.GetFileName(dir), StringComparer.Ordinal);
        await using var connection = await OpenAsync("tickets_owner");
        foreach (var dir in migrations)
        {
            await using var command = new NpgsqlCommand(
                await File.ReadAllTextAsync(Path.Combine(dir, "migration.sql")), connection);
            await command.ExecuteNonQueryAsync();
        }
    }

    public Task DisposeAsync() => _container.DisposeAsync().AsTask();

    /// <summary>postgresql://role:test-password@host:port/eticketing?schema=tickets</summary>
    public string UrlFor(string role) =>
        $"postgresql://{role}:{TestPassword}@{_container.Hostname}:{_container.GetMappedPublicPort(5432)}/{Database}?schema=tickets";

    public async Task<NpgsqlConnection> OpenAsync(string role)
    {
        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = _container.Hostname,
            Port = _container.GetMappedPublicPort(5432),
            Database = Database,
            Username = role,
            Password = TestPassword,
            SearchPath = "tickets",
        };
        var connection = new NpgsqlConnection(builder.ConnectionString);
        await connection.OpenAsync();
        return connection;
    }

    private static string FindRepoRoot()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "pnpm-workspace.yaml")))
        {
            dir = dir.Parent;
        }
        return dir?.FullName ?? throw new InvalidOperationException("Repository root (pnpm-workspace.yaml) not found");
    }
}
