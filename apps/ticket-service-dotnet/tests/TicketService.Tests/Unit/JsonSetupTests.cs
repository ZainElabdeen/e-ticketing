using System.Text.Json;
using TicketService.Api.Http;

namespace TicketService.Tests.Unit;

[Trait("Category", "Unit")]
public sealed class JsonSetupTests
{
    private sealed record Body(int Quantity, string? Note, DateTime At);

    private static readonly JsonSerializerOptions Options = JsonSetup.Create();

    [Fact]
    public void Writes_camelCase_nulls_and_js_style_timestamps()
    {
        var json = JsonSerializer.Serialize(
            new Body(2, null, new DateTime(2026, 11, 14, 1, 2, 3, 4, DateTimeKind.Utc)), Options);

        Assert.Equal("{\"quantity\":2,\"note\":null,\"at\":\"2026-11-14T01:02:03.004Z\"}", json);
    }

    [Theory]
    [InlineData("{\"quantity\":\"2\",\"at\":\"2026-11-14T01:02:03.004Z\"}")]
    [InlineData("{\"quantity\":2,\"extra\":1,\"at\":\"2026-11-14T01:02:03.004Z\"}")]
    [InlineData("{\"Quantity\":2,\"at\":\"2026-11-14T01:02:03.004Z\"}")]
    public void Rejects_string_numbers_unknown_members_and_wrong_case(string json)
    {
        Assert.Throws<JsonException>(() => JsonSerializer.Deserialize<Body>(json, Options));
    }
}
