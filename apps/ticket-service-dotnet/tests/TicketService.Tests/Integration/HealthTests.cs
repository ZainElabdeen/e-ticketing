using System.Diagnostics;
using System.Net;
using System.Text.Json;
using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

[Trait("Category", "Integration")]
[Collection(PostgresCollection.Name)]
public sealed class HealthTests(PostgresFixture db)
{
    [Fact]
    public async Task Live_is_200_without_a_key()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ok", await StatusOf(response));
    }

    [Fact]
    public async Task Ready_is_200_when_the_database_answers()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/ready");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("ok", await StatusOf(response));
    }

    [Fact]
    public async Task Ready_is_503_quickly_when_the_database_is_unreachable_and_live_stays_200()
    {
        await using var factory = new TicketServiceFactory(db, new Dictionary<string, string?>
        {
            ["DATABASE_URL"] = "postgresql://tickets_app:x@127.0.0.1:1/eticketing?schema=tickets",
        });
        using var client = factory.CreateClient();

        var watch = Stopwatch.StartNew();
        var ready = await client.GetAsync("/health/ready");
        watch.Stop();
        var live = await client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.ServiceUnavailable, ready.StatusCode);
        Assert.True(watch.Elapsed < TimeSpan.FromSeconds(3), $"took {watch.Elapsed}");
        using var body = JsonDocument.Parse(await ready.Content.ReadAsStringAsync());
        Assert.Equal("error", body.RootElement.GetProperty("status").GetString());
        Assert.Equal("down", body.RootElement.GetProperty("details").GetProperty("database").GetProperty("status").GetString());
        Assert.Equal(HttpStatusCode.OK, live.StatusCode);
    }

    private static async Task<string?> StatusOf(HttpResponseMessage response)
    {
        using var body = JsonDocument.Parse(await response.Content.ReadAsStringAsync());
        return body.RootElement.GetProperty("status").GetString();
    }
}
