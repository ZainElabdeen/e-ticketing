namespace TicketService.Tests.Support;

/// <summary>
/// A second Postgres container for tests that change quota or prices. Kept apart from the shared
/// "postgres" collection so they cannot disturb its tests; each test resets the state it touches.
/// </summary>
[CollectionDefinition(Name)]
public sealed class ExclusivePostgresCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "postgres-exclusive";
}
