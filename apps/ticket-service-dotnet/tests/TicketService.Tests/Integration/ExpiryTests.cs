using Microsoft.AspNetCore.Hosting;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using TicketService.Api.Infrastructure;
using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

[Trait("Category", "Integration")]
[Collection(ExclusivePostgresCollection.Name)]
public sealed class ExpiryTests(PostgresFixture db) : IAsyncLifetime
{
    public Task InitializeAsync() => ApiClient.ResetAllAsync(db);

    public Task DisposeAsync() => ApiClient.ResetAllAsync(db);

    private static async Task<string> CreateAsync(HttpClient client, TicketServiceFactory factory, int qty = 1)
    {
        var (status, order) = await ApiClient.SendAsync(client, HttpMethod.Post, "/v1/orders", factory.PublicKey,
            ApiClient.OrderJson(("GOLD", qty)));
        Assert.Equal(201, status);
        return order.GetProperty("id").GetString()!;
    }

    private static async Task<int> RunAsync(TicketServiceFactory factory)
    {
        using var scope = factory.Services.CreateScope();
        return await scope.ServiceProvider.GetRequiredService<OrderExpiryRunner>().RunOnceAsync(default);
    }

    [Fact]
    public async Task Expires_due_orders_once_and_releases_the_reservation()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var id = await CreateAsync(client, factory, 3);
        await ApiClient.MakeDueAsync(db, id);

        Assert.Equal(1, await RunAsync(factory));
        Assert.Equal(0, await RunAsync(factory));

        Assert.Equal("EXPIRED", await ApiClient.OrderStatusAsync(db, id));
        Assert.Equal((0, 0), await ApiClient.CountsAsync(db, "GOLD"));
    }

    [Fact]
    public async Task Leaves_non_due_and_confirmed_orders_alone()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var notDue = await CreateAsync(client, factory);
        var paid = await CreateAsync(client, factory);
        var (status, _) = await ApiClient.SendAsync(client, HttpMethod.Post, $"/v1/internal/orders/{paid}/confirm",
            factory.InternalKey, $"{{\"transactionId\":\"{Guid.NewGuid()}\"}}");
        Assert.Equal(200, status);
        await ApiClient.MakeDueAsync(db, paid);

        Assert.Equal(0, await RunAsync(factory));

        Assert.Equal("PENDING", await ApiClient.OrderStatusAsync(db, notDue));
        Assert.Equal("CONFIRMED", await ApiClient.OrderStatusAsync(db, paid));
        Assert.Equal((1, 1), await ApiClient.CountsAsync(db, "GOLD"));
    }

    [Fact]
    public async Task A_run_stops_at_the_batch_size()
    {
        await using var factory = new TicketServiceFactory(db, new Dictionary<string, string?> { ["ORDER_EXPIRY_BATCH_SIZE"] = "2" });
        using var client = factory.CreateClient();
        var ids = new List<string>();
        for (var i = 0; i < 3; i++)
        {
            ids.Add(await CreateAsync(client, factory));
        }
        await ApiClient.MakeDueAsync(db, [.. ids]);

        Assert.Equal(2, await RunAsync(factory));
        Assert.Equal(1, await RunAsync(factory));
    }

    [Fact]
    public async Task Confirms_racing_the_expiry_job_never_double_release_or_double_count()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var ids = new List<string>();
        for (var i = 0; i < 20; i++)
        {
            ids.Add(await CreateAsync(client, factory));
        }
        await ApiClient.MakeDueAsync(db, [.. ids]);

        var work = ids.Select(id => Task.Run(async () =>
        {
            using var scope = factory.Services.CreateScope();
            await scope.ServiceProvider.GetRequiredService<OrdersRepository>()
                .ConfirmAsync(Guid.Parse(id), Guid.NewGuid(), default);
        })).ToList();
        work.Add(Task.Run(() => RunAsync(factory)));
        await Task.WhenAll(work);

        foreach (var id in ids)
        {
            Assert.Equal("CONFIRMED", await ApiClient.OrderStatusAsync(db, id));
        }
        Assert.Equal((20, 0), await ApiClient.CountsAsync(db, "GOLD"));
    }

    [Theory]
    [InlineData("true", 1)]
    [InlineData("false", 0)]
    public void The_hosted_service_is_registered_only_when_enabled(string enabled, int expected)
    {
        using var factory = new TicketServiceFactory(db, new Dictionary<string, string?> { ["ORDER_EXPIRY_ENABLED"] = enabled });

        Assert.Equal(expected, factory.Services.GetServices<IHostedService>().OfType<OrderExpiryJob>().Count());
    }
}
