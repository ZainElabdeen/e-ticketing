using System.Net;
using System.Text.Json;
using Microsoft.Extensions.DependencyInjection;
using TicketService.Api.Infrastructure;
using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

/// <summary>Moves quota and order state, so it runs on the exclusive container and resets it.</summary>
[Trait("Category", "Integration")]
[Collection(ExclusivePostgresCollection.Name)]
public sealed class ConfirmTests(PostgresFixture db) : IAsyncLifetime
{
    public Task InitializeAsync() => ApiClient.ResetAllAsync(db);

    public Task DisposeAsync() => ApiClient.ResetAllAsync(db);

    private static string Body(Guid transactionId) => $"{{\"transactionId\":\"{transactionId}\"}}";

    private static async Task<string> CreateAsync(HttpClient client, TicketServiceFactory factory, params (string, int)[] items)
    {
        var (status, order) = await ApiClient.SendAsync(client, HttpMethod.Post, "/v1/orders", factory.PublicKey,
            ApiClient.OrderJson(items));
        Assert.Equal(201, status);
        return order.GetProperty("id").GetString()!;
    }

    private static Task<(int Status, JsonElement Body)> Confirm(
        HttpClient client, TicketServiceFactory factory, string orderId, string json) =>
        ApiClient.SendAsync(client, HttpMethod.Post, $"/v1/internal/orders/{orderId}/confirm", factory.InternalKey, json);

    [Fact]
    public async Task Confirming_a_pending_order_moves_reserved_to_sold()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var id = await CreateAsync(client, factory, ("GOLD", 2));
        var t = Guid.NewGuid();

        var (status, body) = await Confirm(client, factory, id, Body(t));

        Assert.Equal(200, status);
        Assert.Equal("CONFIRMED", body.GetProperty("status").GetString());
        Assert.Equal(t.ToString(), body.GetProperty("paidTransactionId").GetString());
        Assert.NotEqual(JsonValueKind.Null, body.GetProperty("confirmedAt").ValueKind);
        Assert.Equal((2, 0), await ApiClient.CountsAsync(db, "GOLD"));
    }

    [Fact]
    public async Task Replay_conflict_and_a_reused_transaction()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var first = await CreateAsync(client, factory, ("GOLD", 1));
        var second = await CreateAsync(client, factory, ("GOLD", 1));
        var t = Guid.NewGuid();
        var (_, firstBody) = await Confirm(client, factory, first, Body(t));
        var before = await ApiClient.CountsAsync(db, "GOLD");

        var (replayStatus, replay) = await Confirm(client, factory, first, Body(t));
        var (otherStatus, other) = await Confirm(client, factory, first, Body(Guid.NewGuid()));
        var (reuseStatus, reuse) = await Confirm(client, factory, second, Body(t));

        Assert.Equal(200, replayStatus);
        Assert.Equal(firstBody.GetRawText(), replay.GetRawText());
        Assert.Equal(before, await ApiClient.CountsAsync(db, "GOLD"));
        Assert.Equal(409, otherStatus);
        Assert.Equal("ORDER_NOT_CONFIRMABLE", other.GetProperty("code").GetString());
        Assert.Equal(409, reuseStatus);
        Assert.Equal("ORDER_NOT_CONFIRMABLE", reuse.GetProperty("code").GetString());
        Assert.Equal("PENDING", await ApiClient.OrderStatusAsync(db, second));
    }

    [Fact]
    public async Task An_unknown_order_is_404()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var (status, body) = await Confirm(client, factory, Guid.NewGuid().ToString(), Body(Guid.NewGuid()));

        Assert.Equal(404, status);
        Assert.Equal("NOT_FOUND", body.GetProperty("code").GetString());
    }

    [Theory]
    [InlineData("{}")]
    [InlineData("null")]
    [InlineData("{\"transactionId\":null}")]
    [InlineData("{\"transactionId\":\"x\"}")]
    [InlineData("{\"transactionId\":5}")]
    [InlineData("{\"transactionId\":\"11111111-1111-1111-1111-111111111111\",\"extra\":1}")]
    public async Task Bad_bodies_are_400(string json)
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var (status, body) = await Confirm(client, factory, Guid.NewGuid().ToString(), json);

        Assert.Equal(400, status);
        Assert.Equal("VALIDATION_ERROR", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task A_non_uuid_path_is_400()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var (status, body) = await Confirm(client, factory, "not-a-uuid", Body(Guid.NewGuid()));

        Assert.Equal(400, status);
        Assert.Equal("VALIDATION_ERROR", body.GetProperty("code").GetString());
    }

    [Fact]
    public async Task Key_scopes_are_enforced()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var id = await CreateAsync(client, factory, ("GOLD", 1));

        var (publicStatus, publicBody) = await ApiClient.SendAsync(client, HttpMethod.Post,
            $"/v1/internal/orders/{id}/confirm", factory.PublicKey, Body(Guid.NewGuid()));
        var (casedStatus, _) = await ApiClient.SendAsync(client, HttpMethod.Post,
            $"/V1/INTERNAL/orders/{id}/confirm", factory.PublicKey, Body(Guid.NewGuid()));
        var (readStatus, _) = await ApiClient.SendAsync(client, HttpMethod.Get, $"/v1/orders/{id}", factory.InternalKey);

        Assert.Equal(403, publicStatus);
        Assert.Equal("FORBIDDEN", publicBody.GetProperty("code").GetString());
        Assert.True(casedStatus is 403 or 404);
        Assert.Equal(200, readStatus);
        Assert.Equal("PENDING", await ApiClient.OrderStatusAsync(db, id));
    }

    [Fact]
    public async Task An_expired_order_is_honoured_while_quota_allows()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var id = await CreateAsync(client, factory, ("GOLD", 2));
        await ApiClient.MakeDueAsync(db, id);
        using (var scope = factory.Services.CreateScope())
        {
            Assert.Equal(1, await scope.ServiceProvider.GetRequiredService<OrderExpiryRunner>().RunOnceAsync(default));
        }
        Assert.Equal("EXPIRED", await ApiClient.OrderStatusAsync(db, id));

        var (status, body) = await Confirm(client, factory, id, Body(Guid.NewGuid()));

        Assert.Equal(200, status);
        Assert.Equal("CONFIRMED", body.GetProperty("status").GetString());
        Assert.Equal((2, 0), await ApiClient.CountsAsync(db, "GOLD"));
    }

    [Fact]
    public async Task An_expired_order_whose_quota_is_gone_stays_expired_and_changes_nothing()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var id = await CreateAsync(client, factory, ("GOLD", 1), ("VIP", 1));
        await ApiClient.MakeDueAsync(db, id);
        using (var scope = factory.Services.CreateScope())
        {
            await scope.ServiceProvider.GetRequiredService<OrderExpiryRunner>().RunOnceAsync(default);
        }
        await ApiClient.ExecuteAsync(db, "UPDATE tickets.ticket_types SET sold = quota WHERE code = 'VIP'");

        var (status, body) = await Confirm(client, factory, id, Body(Guid.NewGuid()));

        Assert.Equal(409, status);
        Assert.Equal("ORDER_NOT_CONFIRMABLE", body.GetProperty("code").GetString());
        Assert.Equal("EXPIRED", await ApiClient.OrderStatusAsync(db, id));
        Assert.Equal((0, 0), await ApiClient.CountsAsync(db, "GOLD"));
        Assert.Equal((100, 0), await ApiClient.CountsAsync(db, "VIP"));
    }

    [Fact]
    public async Task Five_concurrent_confirms_with_one_transaction_all_succeed_and_count_once()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var id = await CreateAsync(client, factory, ("GOLD", 3));
        var t = Guid.NewGuid();

        var results = await Task.WhenAll(Enumerable.Range(0, 5).Select(_ => Task.Run(() => Confirm(client, factory, id, Body(t)))));

        Assert.All(results, r =>
        {
            Assert.Equal(200, r.Status);
            Assert.Equal("CONFIRMED", r.Body.GetProperty("status").GetString());
        });
        Assert.Equal((3, 0), await ApiClient.CountsAsync(db, "GOLD"));
    }

    [Fact]
    public async Task Four_orders_racing_on_one_transaction_confirm_exactly_one()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var ids = new List<string>();
        for (var i = 0; i < 4; i++)
        {
            ids.Add(await CreateAsync(client, factory, ("GOLD", 1)));
        }
        var t = Guid.NewGuid();

        var results = await Task.WhenAll(ids.Select(id => Task.Run(() => Confirm(client, factory, id, Body(t)))));

        Assert.Equal(1, results.Count(r => r.Status == 200));
        Assert.Equal(3, results.Count(r => r.Status == 409));
        Assert.All(results.Where(r => r.Status == 409), r =>
            Assert.Equal("ORDER_NOT_CONFIRMABLE", r.Body.GetProperty("code").GetString()));
        Assert.Equal((1, 3), await ApiClient.CountsAsync(db, "GOLD"));
    }
}
