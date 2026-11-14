namespace TicketService.Tests.Support;

/// <summary>
/// One Postgres container for the whole integration suite. Classes in this collection run
/// sequentially against shared state, so tests that mutate it (orders, quota) must create their own
/// data and assert only on it, or reset what they touch.
/// </summary>
[CollectionDefinition(Name)]
public sealed class PostgresCollection : ICollectionFixture<PostgresFixture>
{
    public const string Name = "postgres";
}
