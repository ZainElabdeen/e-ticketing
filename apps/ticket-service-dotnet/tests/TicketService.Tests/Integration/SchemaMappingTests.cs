using Microsoft.EntityFrameworkCore;
using Npgsql;
using TicketService.Api.Config;
using TicketService.Api.Infrastructure;
using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

[Trait("Category", "Integration")]
[Collection(PostgresCollection.Name)]
public sealed class SchemaMappingTests(PostgresFixture db)
{
    private TicketsDbContext NewContext()
    {
        EnvLoader.TryTranslateDatabaseUrl(db.UrlFor("tickets_app"), out var connectionString, out _);
        var options = new DbContextOptionsBuilder<TicketsDbContext>().UseNpgsql(connectionString).Options;
        return new TicketsDbContext(options);
    }

    [Fact]
    public async Task Loads_the_three_seeded_ticket_types()
    {
        await using var context = NewContext();

        var types = await context.TicketTypes.OrderBy(t => t.Code).ToListAsync();

        Assert.Equal(["GOLD", "PREMIUM", "VIP"], types.Select(t => t.Code));
        Assert.Equal([10000L, 20000L, 50000L], types.Select(t => t.PriceMinor));
        Assert.All(types, t =>
        {
            Assert.Equal("AED", t.Currency);
            Assert.Equal(100, t.Quota);
            Assert.Equal(0, t.Sold);
            Assert.Equal(0, t.Reserved);
        });
    }

    [Fact]
    public async Task Round_trips_every_order_and_item_column()
    {
        var orderId = Guid.NewGuid();
        var itemId = Guid.NewGuid();
        var transactionId = Guid.NewGuid();
        var created = new DateTime(2026, 1, 2, 3, 4, 5, 678, DateTimeKind.Utc);
        var expires = created.AddMinutes(15);
        var confirmed = created.AddMinutes(1);

        await using (var connection = await db.OpenAsync("tickets_app"))
        {
            await using var insert = new NpgsqlCommand(
                """
                INSERT INTO tickets.orders (id, status, total_minor, currency, created_at, expires_at, confirmed_at, paid_transaction_id)
                VALUES (@id, 'CONFIRMED', 20000, 'AED', @created, @expires, @confirmed, @tx);
                INSERT INTO tickets.order_items (id, order_id, ticket_type_id, quantity, unit_price_minor, line_total_minor)
                SELECT @item, @id, id, 2, 10000, 20000 FROM tickets.ticket_types WHERE code = 'GOLD';
                """,
                connection);
            insert.Parameters.AddWithValue("id", orderId);
            insert.Parameters.AddWithValue("item", itemId);
            insert.Parameters.AddWithValue("tx", transactionId);
            insert.Parameters.AddWithValue("created", created);
            insert.Parameters.AddWithValue("expires", expires);
            insert.Parameters.AddWithValue("confirmed", confirmed);
            await insert.ExecuteNonQueryAsync();
        }

        await using var context = NewContext();
        var order = await context.Orders.Include(o => o.Items).SingleAsync(o => o.Id == orderId);
        var goldId = await context.TicketTypes.Where(t => t.Code == "GOLD").Select(t => t.Id).SingleAsync();

        Assert.Equal("CONFIRMED", order.Status);
        Assert.Equal(20000, order.TotalMinor);
        Assert.Equal("AED", order.Currency);
        Assert.Equal(created, order.CreatedAt);
        Assert.Equal(DateTimeKind.Utc, order.CreatedAt.Kind);
        Assert.Equal(expires, order.ExpiresAt);
        Assert.Equal(confirmed, order.ConfirmedAt);
        Assert.Equal(transactionId, order.PaidTransactionId);
        var item = Assert.Single(order.Items);
        Assert.Equal(itemId, item.Id);
        Assert.Equal(orderId, item.OrderId);
        Assert.Equal(goldId, item.TicketTypeId);
        Assert.Equal(2, item.Quantity);
        Assert.Equal(10000, item.UnitPriceMinor);
        Assert.Equal(20000, item.LineTotalMinor);
    }
}
