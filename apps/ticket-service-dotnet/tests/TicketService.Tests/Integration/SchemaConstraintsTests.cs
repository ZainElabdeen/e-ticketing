using Npgsql;
using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

/// <summary>
/// Covers the tickets schema's CHECK
/// constraints, grants, seed and oversell race. Mutates shared state, so it runs on its own container.
/// </summary>
[Trait("Category", "Integration")]
[Collection(ExclusivePostgresCollection.Name)]
public sealed class SchemaConstraintsTests(PostgresFixture db) : IAsyncLifetime
{
    private const string ReserveSql = """
        UPDATE tickets.ticket_types
           SET reserved = reserved + @qty
         WHERE code = @code AND sold + reserved + @qty <= quota
        RETURNING id
        """;

    public Task InitializeAsync() => ApiClient.ResetAllAsync(db);

    public Task DisposeAsync() => ApiClient.ResetAllAsync(db);

    private static NpgsqlCommand Command(NpgsqlConnection connection, string sql, params (string Name, object? Value)[] args)
    {
        var command = new NpgsqlCommand(sql, connection);
        foreach (var (name, value) in args)
        {
            command.Parameters.AddWithValue(name, value ?? DBNull.Value);
        }
        return command;
    }

    private static async Task<int> ExecAsync(NpgsqlConnection connection, string sql, params (string, object?)[] args)
    {
        await using var command = Command(connection, sql, args);
        return await command.ExecuteNonQueryAsync();
    }

    /// <summary>Number of rows RETURNING produced.</summary>
    private static async Task<int> ReserveAsync(NpgsqlConnection connection, int qty, string code, NpgsqlTransaction? tx = null)
    {
        await using var command = Command(connection, ReserveSql, ("qty", qty), ("code", code));
        command.Transaction = tx;
        await using var reader = await command.ExecuteReaderAsync();
        var rows = 0;
        while (await reader.ReadAsync())
        {
            rows++;
        }
        return rows;
    }

    private static Task<Guid> InsertOrderAsync(NpgsqlConnection app, string status, DateTime? confirmedAt = null, Guid? paidTransactionId = null) =>
        InsertOrderAsync(app, status, 10000, confirmedAt, paidTransactionId);

    private static async Task<Guid> InsertOrderAsync(NpgsqlConnection app, string status, long totalMinor, DateTime? confirmedAt, Guid? paidTransactionId)
    {
        var id = Guid.NewGuid();
        await ExecAsync(app,
            """
            INSERT INTO tickets.orders (id, status, total_minor, expires_at, confirmed_at, paid_transaction_id)
            VALUES (@id, @status, @total, now() + interval '15 minutes', @confirmedAt, @paid)
            """,
            ("id", id), ("status", status), ("total", totalMinor), ("confirmedAt", confirmedAt), ("paid", paidTransactionId));
        return id;
    }

    private static Task<int> InsertItemAsync(NpgsqlConnection app, Guid orderId, int quantity, long unitMinor, long lineMinor) =>
        ExecAsync(app,
            """
            INSERT INTO tickets.order_items (order_id, ticket_type_id, quantity, unit_price_minor, line_total_minor)
            SELECT @order, id, @qty, @unit, @line FROM tickets.ticket_types WHERE code = 'GOLD'
            """,
            ("order", orderId), ("qty", quantity), ("unit", unitMinor), ("line", lineMinor));

    private static async Task AssertSqlState(string sqlState, Func<Task> action)
    {
        var ex = await Assert.ThrowsAsync<PostgresException>(action);
        Assert.Equal(sqlState, ex.SqlState);
    }

    [Fact]
    public async Task SeedsTheThreeTicketTypes()
    {
        await using var app = await db.OpenAsync("tickets_app");
        await using var command = Command(app,
            "SELECT code, name, price_minor, currency, quota, sold, reserved FROM tickets.ticket_types ORDER BY price_minor");
        await using var reader = await command.ExecuteReaderAsync();
        var rows = new List<(string, string, long, string, int, int, int)>();
        while (await reader.ReadAsync())
        {
            rows.Add((reader.GetString(0), reader.GetString(1), reader.GetInt64(2), reader.GetString(3),
                reader.GetInt32(4), reader.GetInt32(5), reader.GetInt32(6)));
        }

        Assert.Equal(
            [
                ("GOLD", "Gold", 10000L, "AED", 100, 0, 0),
                ("PREMIUM", "Premium", 20000L, "AED", 100, 0, 0),
                ("VIP", "VIP", 50000L, "AED", 100, 0, 0),
            ],
            rows);
    }

    [Fact]
    public async Task RejectsSoldPlusReservedAboveQuota()
    {
        await using var app = await db.OpenAsync("tickets_app");

        await AssertSqlState("23514", () => ExecAsync(app, "UPDATE tickets.ticket_types SET reserved = 101 WHERE code = 'GOLD'"));
    }

    [Fact]
    public async Task ConditionalReservationStopsAtQuotaEdge()
    {
        await using var app = await db.OpenAsync("tickets_app");
        await using var tx = await app.BeginTransactionAsync();
        await ExecAsync(app, "UPDATE tickets.ticket_types SET sold = 95 WHERE code = 'GOLD'");

        Assert.Equal(0, await ReserveAsync(app, 6, "GOLD", tx));
        Assert.Equal(1, await ReserveAsync(app, 5, "GOLD", tx));

        await tx.RollbackAsync();
    }

    [Fact]
    public async Task NeverOversellsUnder20ConcurrentReservationsOf10()
    {
        var connections = new List<NpgsqlConnection>();
        try
        {
            for (var i = 0; i < 20; i++)
            {
                connections.Add(await db.OpenAsync("tickets_app"));
            }

            var results = await Task.WhenAll(connections.Select(c => ReserveAsync(c, 10, "GOLD")));

            Assert.Equal(10, results.Count(r => r == 1));
        }
        finally
        {
            foreach (var connection in connections)
            {
                await connection.DisposeAsync();
            }
        }

        var (sold, reserved) = await ApiClient.CountsAsync(db, "GOLD");
        Assert.Equal(0, sold);
        Assert.Equal(100, reserved);
    }

    [Fact]
    public async Task TiesConfirmedToConfirmedAtAndPaidTransactionId()
    {
        await using var app = await db.OpenAsync("tickets_app");

        await AssertSqlState("23514", () => InsertOrderAsync(app, "CONFIRMED"));
        await AssertSqlState("23514", () => InsertOrderAsync(app, "PENDING", DateTime.UtcNow, Guid.NewGuid()));

        var id = await InsertOrderAsync(app, "CONFIRMED", DateTime.UtcNow, Guid.NewGuid());
        Assert.NotEqual(Guid.Empty, id);
    }

    [Fact]
    public async Task RejectsUnknownOrderStatus()
    {
        await using var app = await db.OpenAsync("tickets_app");

        await AssertSqlState("23514", () => InsertOrderAsync(app, "CANCELLED"));
    }

    [Fact]
    public async Task KeepsPaidTransactionIdUnique()
    {
        await using var app = await db.OpenAsync("tickets_app");
        var transactionId = Guid.NewGuid();
        var confirmedAt = DateTime.UtcNow;

        await InsertOrderAsync(app, "CONFIRMED", confirmedAt, transactionId);

        await AssertSqlState("23505", () => InsertOrderAsync(app, "CONFIRMED", confirmedAt, transactionId));
    }

    [Fact]
    public async Task ValidatesOrderItems()
    {
        await using var app = await db.OpenAsync("tickets_app");
        var orderId = await InsertOrderAsync(app, "PENDING");

        await AssertSqlState("23514", () => InsertItemAsync(app, orderId, 11, 10000, 110000));
        await AssertSqlState("23514", () => InsertItemAsync(app, orderId, 2, 10000, 99999));

        Assert.Equal(1, await InsertItemAsync(app, orderId, 2, 10000, 20000));
        await AssertSqlState("23505", () => InsertItemAsync(app, orderId, 1, 10000, 10000));
    }

    [Fact]
    public async Task BlocksDeletingTicketTypeWithOrderItems()
    {
        await using var app = await db.OpenAsync("tickets_app");
        var orderId = await InsertOrderAsync(app, "PENDING");
        await InsertItemAsync(app, orderId, 1, 10000, 10000);

        await using var owner = await db.OpenAsync("tickets_owner");

        await AssertSqlState("23503", () => ExecAsync(owner, "DELETE FROM tickets.ticket_types WHERE code = 'GOLD'"));
    }

    [Fact]
    public async Task DeniesTicketsAppAccessToPaymentsSchema()
    {
        await using var app = await db.OpenAsync("tickets_app");

        await AssertSqlState("42501", async () =>
        {
            await using var command = Command(app, "SELECT 1 FROM payments.payments");
            await command.ExecuteScalarAsync();
        });
    }
}
