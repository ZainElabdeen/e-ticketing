using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

/// <summary>Mutates quota and prices, so it runs on its own container and resets what it touches.</summary>
[Trait("Category", "Integration")]
[Collection(ExclusivePostgresCollection.Name)]
public sealed class ReservationRaceTests(PostgresFixture db) : IAsyncLifetime
{
    public Task InitializeAsync() => ApiClient.ResetTicketTypesAsync(db);

    public Task DisposeAsync() => ApiClient.ResetTicketTypesAsync(db);

    private static async Task<int> Available(HttpClient client, string key, string code)
    {
        var (_, body) = await ApiClient.SendAsync(client, HttpMethod.Get, "/v1/ticket-types", key);
        return body.GetProperty("data").EnumerateArray()
            .Single(r => r.GetProperty("code").GetString() == code).GetProperty("available").GetInt32();
    }

    [Fact]
    public async Task A_failed_line_rolls_back_the_earlier_ones()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var vip = await Available(client, factory.PublicKey, "VIP");
        while (vip > 0)
        {
            var chunk = Math.Min(10, vip);
            var (s, _) = await ApiClient.SendAsync(client, HttpMethod.Post, "/v1/orders", factory.PublicKey,
                ApiClient.OrderJson(("VIP", chunk)));
            Assert.Equal(201, s);
            vip -= chunk;
        }
        var goldBefore = await Available(client, factory.PublicKey, "GOLD");

        var (status, body) = await ApiClient.SendAsync(client, HttpMethod.Post, "/v1/orders", factory.PublicKey,
            ApiClient.OrderJson(("GOLD", 1), ("VIP", 1)));

        Assert.Equal(409, status);
        Assert.Equal("QUOTA_EXCEEDED", body.GetProperty("code").GetString());
        Assert.Contains("VIP", body.GetProperty("message").GetString());
        Assert.Equal(goldBefore, await Available(client, factory.PublicKey, "GOLD"));
    }

    [Fact]
    public async Task Concurrent_orders_in_opposite_item_order_never_oversell_or_deadlock()
    {
        await ApiClient.ExecuteAsync(db, "UPDATE tickets.ticket_types SET quota = 5 WHERE code IN ('GOLD','VIP')");
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var forward = ApiClient.OrderJson(("GOLD", 1), ("VIP", 1));
        var reverse = ApiClient.OrderJson(("VIP", 1), ("GOLD", 1));

        var results = await Task.WhenAll(Enumerable.Range(0, 24).Select(i =>
            Task.Run(() => ApiClient.SendAsync(client, HttpMethod.Post, "/v1/orders", factory.PublicKey,
                i % 2 == 0 ? forward : reverse))));

        Assert.Equal(5, results.Count(r => r.Status == 201));
        var failures = results.Where(r => r.Status != 201).ToList();
        Assert.Equal(19, failures.Count);
        Assert.All(failures, f =>
        {
            Assert.Equal(409, f.Status);
            Assert.Equal("QUOTA_EXCEEDED", f.Body.GetProperty("code").GetString());
        });
        var (_, types) = await ApiClient.SendAsync(client, HttpMethod.Get, "/v1/ticket-types", factory.PublicKey);
        foreach (var code in new[] { "GOLD", "VIP" })
        {
            var row = types.GetProperty("data").EnumerateArray().Single(r => r.GetProperty("code").GetString() == code);
            Assert.Equal(5, row.GetProperty("reserved").GetInt32());
            Assert.Equal(0, row.GetProperty("available").GetInt32());
        }
    }

    [Fact]
    public async Task The_price_comes_from_the_database()
    {
        await ApiClient.ExecuteAsync(db, "UPDATE tickets.ticket_types SET price_minor = 12345 WHERE code = 'GOLD'");
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var (status, order) = await ApiClient.SendAsync(client, HttpMethod.Post, "/v1/orders", factory.PublicKey,
            ApiClient.OrderJson(("GOLD", 3)));

        Assert.Equal(201, status);
        Assert.Equal(37035, order.GetProperty("totalMinor").GetInt64());
    }
}
