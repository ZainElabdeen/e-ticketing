using System.Text.RegularExpressions;
using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

[Trait("Category", "Integration")]
[Collection(PostgresCollection.Name)]
public sealed partial class OrdersTests(PostgresFixture db)
{
    [GeneratedRegex(@"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$")]
    private static partial Regex Iso();

    private async Task<(int Status, System.Text.Json.JsonElement Body)> Send(
        HttpMethod method, string path, string? json = null)
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        return await ApiClient.SendAsync(client, method, path, factory.PublicKey, json);
    }

    [Fact]
    public async Task Creates_a_pending_server_priced_order_and_reads_it_back()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var (status, order) = await ApiClient.SendAsync(client, HttpMethod.Post, "/v1/orders", factory.PublicKey,
            ApiClient.OrderJson(("VIP", 1), ("GOLD", 2)));

        Assert.Equal(201, status);
        Assert.Equal("PENDING", order.GetProperty("status").GetString());
        Assert.Equal(70000, order.GetProperty("totalMinor").GetInt64());
        Assert.Equal("AED", order.GetProperty("currency").GetString());
        Assert.Equal(
            ["confirmedAt", "createdAt", "currency", "expiresAt", "id", "items", "paidTransactionId", "status", "totalMinor"],
            order.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        var items = order.GetProperty("items").EnumerateArray().ToList();
        Assert.Equal(["GOLD", "VIP"], items.Select(i => i.GetProperty("ticketTypeCode").GetString()));
        Assert.Equal(
            ["lineTotalMinor", "quantity", "ticketTypeCode", "unitPriceMinor"],
            items[0].EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal(20000, items[0].GetProperty("lineTotalMinor").GetInt64());
        Assert.Equal(System.Text.Json.JsonValueKind.Null, order.GetProperty("confirmedAt").ValueKind);
        Assert.Equal(System.Text.Json.JsonValueKind.Null, order.GetProperty("paidTransactionId").ValueKind);
        var created = order.GetProperty("createdAt").GetString()!;
        var expires = order.GetProperty("expiresAt").GetString()!;
        Assert.Matches(Iso(), created);
        Assert.Matches(Iso(), expires);
        var delta = DateTimeOffset.Parse(expires) - DateTimeOffset.Parse(created);
        Assert.InRange(delta.TotalSeconds, 15 * 60 - 5, 15 * 60 + 5);

        var id = order.GetProperty("id").GetString()!;
        var (readStatus, read) = await ApiClient.SendAsync(client, HttpMethod.Get, $"/v1/orders/{id}", factory.PublicKey);
        Assert.Equal(200, readStatus);
        Assert.Equal(order.GetRawText(), read.GetRawText());

        var (upperStatus, upper) = await ApiClient.SendAsync(
            client, HttpMethod.Get, $"/v1/orders/{id.ToUpperInvariant()}", factory.PublicKey);
        Assert.Equal(200, upperStatus);
        Assert.Equal(id, upper.GetProperty("id").GetString());
    }

    [Fact]
    public async Task An_unknown_order_is_404_NOT_FOUND()
    {
        var (status, body) = await Send(HttpMethod.Get, $"/v1/orders/{Guid.NewGuid()}");

        Assert.Equal(404, status);
        Assert.Equal("NOT_FOUND", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_non_uuid_order_id_is_400_VALIDATION_ERROR()
    {
        var (status, body) = await Send(HttpMethod.Get, "/v1/orders/not-a-uuid");

        Assert.Equal(400, status);
        Assert.Equal("VALIDATION_ERROR", body.GetProperty("code").GetString());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("null")]
    [InlineData("{\"items\":null}")]
    [InlineData("{\"items\":\"x\"}")]
    [InlineData("{\"items\":{}}")]
    [InlineData("{\"items\":[]}")]
    [InlineData("{\"items\":[null]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\",\"quantity\":1},{\"ticketTypeCode\":\"PREMIUM\",\"quantity\":1},{\"ticketTypeCode\":\"VIP\",\"quantity\":1},{\"ticketTypeCode\":\"GOLD\",\"quantity\":1}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\",\"quantity\":0}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\",\"quantity\":11}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\",\"quantity\":\"2\"}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\",\"quantity\":1.5}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\"}]}")]
    [InlineData("{\"items\":[{\"quantity\":1}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":null,\"quantity\":1}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"BRONZE\",\"quantity\":1}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"gold\",\"quantity\":1}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\",\"quantity\":1},{\"ticketTypeCode\":\"GOLD\",\"quantity\":2}]}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\",\"quantity\":1}],\"extra\":1}")]
    [InlineData("{\"items\":[{\"ticketTypeCode\":\"GOLD\",\"quantity\":1,\"extra\":1}]}")]
    [InlineData("{\"items\":[")]
    public async Task Bad_bodies_are_400_VALIDATION_ERROR(string json)
    {
        var (status, body) = await Send(HttpMethod.Post, "/v1/orders", json);

        Assert.Equal(400, status);
        Assert.Equal("VALIDATION_ERROR", body.GetProperty("code").GetString());
    }
}
