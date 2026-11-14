using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using TicketService.Tests.Support;

namespace TicketService.Tests.Integration;

[Trait("Category", "Integration")]
[Collection(PostgresCollection.Name)]
public sealed class HttpBehaviourTests(PostgresFixture db)
{
    private static readonly string[] EnvelopeKeys = ["code", "correlationId", "message", "statusCode"];

    private static HttpRequestMessage Request(HttpMethod method, string path, string? key, string? json = null,
        string contentType = "application/json")
    {
        var request = new HttpRequestMessage(method, path);
        if (key is not null)
        {
            request.Headers.Add("X-Api-Key", key);
        }
        if (json is not null)
        {
            request.Content = new StringContent(json, Encoding.UTF8, contentType);
        }
        return request;
    }

    private static async Task<JsonElement> EnvelopeOf(HttpResponseMessage response, int status, string code)
    {
        Assert.Equal((HttpStatusCode)status, response.StatusCode);
        Assert.Equal("application/json", response.Content.Headers.ContentType?.MediaType);
        var raw = await response.Content.ReadAsStringAsync();
        var root = JsonDocument.Parse(raw).RootElement.Clone();
        Assert.Equal(EnvelopeKeys, root.EnumerateObject().Select(p => p.Name).Order(StringComparer.Ordinal));
        Assert.Equal(status, root.GetProperty("statusCode").GetInt32());
        Assert.Equal(code, root.GetProperty("code").GetString());
        Assert.True(Guid.TryParseExact(root.GetProperty("correlationId").GetString(), "D", out _));
        return root;
    }

    [Fact]
    public async Task Unknown_v1_path_without_a_key_is_401_and_with_a_key_is_404()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        await EnvelopeOf(await client.SendAsync(Request(HttpMethod.Get, "/v1/nope", null)), 401, "UNAUTHORIZED");
        await EnvelopeOf(
            await client.SendAsync(Request(HttpMethod.Get, "/v1/nope", factory.PublicKey)), 404, "NOT_FOUND");
    }

    [Fact]
    public async Task A_bare_405_becomes_the_envelope_too()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(Request(HttpMethod.Delete, "/v1/test/ok", factory.PublicKey));

        await EnvelopeOf(response, 404, "NOT_FOUND");
    }

    [Fact]
    public async Task A_uuid_correlation_id_is_echoed_in_body_and_header()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var id = Guid.NewGuid().ToString();
        var request = Request(HttpMethod.Get, "/v1/test/ok", null);
        request.Headers.Add("X-Correlation-Id", id);

        var response = await client.SendAsync(request);

        var body = await EnvelopeOf(response, 401, "UNAUTHORIZED");
        Assert.Equal(id, body.GetProperty("correlationId").GetString());
        Assert.Equal(id, response.Headers.GetValues("X-Correlation-Id").Single());
    }

    [Fact]
    public async Task A_bad_correlation_id_is_replaced()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var request = Request(HttpMethod.Get, "/v1/test/ok", null);
        request.Headers.Add("X-Correlation-Id", "evil\\value");

        var response = await client.SendAsync(request);

        Assert.True(Guid.TryParseExact(response.Headers.GetValues("X-Correlation-Id").Single(), "D", out _));
    }

    [Fact]
    public async Task Public_key_gets_403_on_internal_routes_in_any_casing_or_slashing()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        await EnvelopeOf(
            await client.SendAsync(Request(HttpMethod.Post, "/v1/internal/test", factory.PublicKey, "{}")),
            403, "FORBIDDEN");
        await EnvelopeOf(
            await client.SendAsync(Request(HttpMethod.Post, "/v1/internal/forgot", factory.PublicKey, "{}")),
            403, "FORBIDDEN");

        foreach (var path in new[] { "/V1/INTERNAL/test", "//v1//internal/test", "/v1/Internal/forgot" })
        {
            var response = await client.SendAsync(Request(HttpMethod.Post, path, factory.PublicKey, "{}"));
            Assert.True(response.StatusCode is HttpStatusCode.Forbidden or HttpStatusCode.NotFound, path);
        }
    }

    [Fact]
    public async Task Internal_key_reaches_internal_routes()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(Request(HttpMethod.Post, "/v1/internal/test", factory.InternalKey, "{}"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
    }

    [Fact]
    public async Task Malformed_json_is_400_with_a_fixed_message_that_never_echoes_the_payload()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(
            Request(HttpMethod.Post, "/v1/test/echo", factory.PublicKey, "{\"quantity\": 4111111111111111 cvc"));

        var body = await EnvelopeOf(response, 400, "VALIDATION_ERROR");
        Assert.Equal("Malformed JSON body", body.GetProperty("message").GetString());
        Assert.DoesNotContain("4111", body.GetRawText());
        Assert.DoesNotContain("cvc", body.GetRawText());
    }

    [Theory]
    [InlineData("{\"quantity\":\"2\"}")]
    [InlineData("{\"quantity\":2,\"extra\":1}")]
    [InlineData("{\"Quantity\":2}")]
    [InlineData("null")]
    public async Task Strict_binding_rejects_bad_bodies_with_the_envelope(string json)
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(Request(HttpMethod.Post, "/v1/test/echo", factory.PublicKey, json));

        var body = await EnvelopeOf(response, 400, "VALIDATION_ERROR");
        Assert.NotEqual("Malformed JSON body", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task A_good_body_binds()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(
            Request(HttpMethod.Post, "/v1/test/echo", factory.PublicKey, "{\"quantity\":3}"));

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal(3, JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement
            .GetProperty("quantity").GetInt32());
    }

    [Theory]
    [InlineData("text/plain")]
    [InlineData("application/x-www-form-urlencoded")]
    public async Task A_non_json_content_type_is_400_VALIDATION_ERROR_like_the_nestjs_service(string contentType)
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(
            Request(HttpMethod.Post, "/v1/test/echo", factory.PublicKey, "{\"quantity\":3}", contentType));

        await EnvelopeOf(response, 400, "VALIDATION_ERROR");
    }

    [Fact]
    public async Task A_body_over_the_limit_is_413()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var huge = "{\"quantity\":1,\"pad\":\"" + new string('x', 31 * 1024 * 1024) + "\"}";

        var response = await client.SendAsync(Request(HttpMethod.Post, "/v1/test/echo", factory.PublicKey, huge));

        await EnvelopeOf(response, 413, "PAYLOAD_TOO_LARGE");
    }

    [Fact]
    public async Task An_unexpected_exception_is_a_generic_500_without_a_stack()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(Request(HttpMethod.Get, "/v1/test/boom", factory.PublicKey));

        var body = await EnvelopeOf(response, 500, "INTERNAL_ERROR");
        Assert.Equal("Internal server error", body.GetProperty("message").GetString());
        Assert.DoesNotContain("secret", body.GetRawText());
        Assert.DoesNotContain("   at ", body.GetRawText());
    }

    [Fact]
    public async Task A_domain_exception_keeps_its_code_status_and_message()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.SendAsync(Request(HttpMethod.Get, "/v1/test/quota", factory.PublicKey));

        var body = await EnvelopeOf(response, 409, "QUOTA_EXCEEDED");
        Assert.Contains("GOLD", body.GetProperty("message").GetString());
    }

    [Fact]
    public async Task Health_live_is_still_a_bare_status_object()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var response = await client.GetAsync("/health/live");

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("{\"status\":\"ok\"}", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Docs_are_served_without_a_key_when_enabled()
    {
        await using var factory = new TicketServiceFactory(db, new Dictionary<string, string?> { ["SWAGGER_ENABLED"] = "true" });
        using var client = factory.CreateClient();

        var page = await client.GetAsync("/docs");
        var spec = await client.GetAsync("/docs/openapi.json");

        Assert.Equal(HttpStatusCode.OK, page.StatusCode);
        Assert.Equal("text/html", page.Content.Headers.ContentType?.MediaType);
        Assert.Equal(HttpStatusCode.OK, spec.StatusCode);
        Assert.Equal("3.0.3", JsonDocument.Parse(await spec.Content.ReadAsStringAsync()).RootElement
            .GetProperty("openapi").GetString()![..5]);
    }

    [Fact]
    public async Task Docs_are_not_served_when_disabled()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        var page = await client.GetAsync("/docs");
        var spec = await client.GetAsync("/docs/openapi.json");

        Assert.NotEqual(HttpStatusCode.OK, page.StatusCode);
        Assert.NotEqual(HttpStatusCode.OK, spec.StatusCode);
    }

    [Fact]
    public async Task One_request_logs_one_line_with_the_spec_fields_and_never_the_key()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();
        var id = Guid.NewGuid().ToString();
        var request = Request(HttpMethod.Get, "/v1/test/ok", factory.PublicKey);
        request.Headers.Add("X-Correlation-Id", id);

        await client.SendAsync(request);

        var lines = factory.Logs.Lines();
        var line = Assert.Single(lines, l => l.Contains("\"route\""));
        using var json = JsonDocument.Parse(line);
        var root = json.RootElement;
        Assert.Equal("info", root.GetProperty("level").GetString());
        Assert.Equal("ticket-service-dotnet", root.GetProperty("service").GetString());
        Assert.Equal(id, root.GetProperty("correlationId").GetString());
        Assert.Equal("GET", root.GetProperty("method").GetString());
        Assert.Equal("/v1/test/ok", root.GetProperty("route").GetString());
        Assert.Equal(200, root.GetProperty("statusCode").GetInt32());
        Assert.Equal(JsonValueKind.Number, root.GetProperty("durationMs").ValueKind);
        Assert.True(DateTimeOffset.TryParse(root.GetProperty("timestamp").GetString(), out _));
        Assert.DoesNotContain(factory.PublicKey, string.Join('\n', lines));
    }

    [Fact]
    public async Task A_500_is_logged_with_its_stack_but_the_request_line_has_status_500()
    {
        await using var factory = new TicketServiceFactory(db);
        using var client = factory.CreateClient();

        await client.SendAsync(Request(HttpMethod.Get, "/v1/test/boom", factory.PublicKey));

        var lines = factory.Logs.Lines();
        Assert.Contains(lines, l => l.Contains("secret stack detail") && l.Contains("\"correlationId\""));
        Assert.Contains(lines, l => l.Contains("\"route\"") && l.Contains("\"statusCode\":500"));
    }
}
