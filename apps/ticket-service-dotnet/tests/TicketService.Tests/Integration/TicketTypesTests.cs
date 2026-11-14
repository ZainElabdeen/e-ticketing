using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

[Trait("Category", "Integration")]
[Collection(PostgresCollection.Name)]
public sealed class TicketTypesTests(PostgresFixture db)
{
    [Fact]
    public async Task Lists_the_seeded_types_in_code_order_with_the_exact_key_set()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var (status, body) = await ApiClient.SendAsync(client, HttpMethod.Get, "/v1/ticket-types", factory.PublicKey);

        Assert.Equal(200, status);
        var rows = body.GetProperty("data").EnumerateArray().ToList();
        Assert.Equal(["GOLD", "PREMIUM", "VIP"], rows.Select(r => r.GetProperty("code").GetString()));
        Assert.Equal([10000L, 20000L, 50000L], rows.Select(r => r.GetProperty("priceMinor").GetInt64()));
        foreach (var row in rows)
        {
            Assert.Equal(
                ["available", "code", "currency", "name", "priceMinor", "quota", "reserved", "sold"],
                row.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
            Assert.Equal("AED", row.GetProperty("currency").GetString());
            Assert.Equal(100, row.GetProperty("quota").GetInt32());
            Assert.Equal(
                row.GetProperty("quota").GetInt32() - row.GetProperty("sold").GetInt32() - row.GetProperty("reserved").GetInt32(),
                row.GetProperty("available").GetInt32());
        }
    }

    [Fact]
    public async Task Requires_an_api_key()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/v1/ticket-types");

        Assert.Equal(System.Net.HttpStatusCode.Unauthorized, response.StatusCode);
    }
}
