using Microsoft.AspNetCore.Http;
using TicketService.Api.Config;
using TicketService.Api.Http;

namespace TicketService.Tests.Unit;

[Trait("Category", "Unit")]
public sealed class ApiKeyMiddlewareTests
{
    private const string PublicKey = "public-key-public-key-public-key-1";
    private const string InternalKey = "internal-key-internal-key-intern-2";

    private static readonly TicketServiceOptions Options = new(
        3001, "Host=x", "tickets", PublicKey, InternalKey, false, "info", 15, 60, 100, false);

    private static async Task<(int Status, bool Passed, string Body)> Run(
        string path, string? key, params object[] metadata)
    {
        var context = new DefaultHttpContext();
        context.Request.Path = path;
        context.Response.Body = new MemoryStream();
        if (key is not null)
        {
            context.Request.Headers["X-Api-Key"] = key;
        }
        context.SetEndpoint(new Endpoint(_ => Task.CompletedTask, new EndpointMetadataCollection(metadata), "test"));

        var passed = false;
        var middleware = new ApiKeyMiddleware(_ =>
        {
            passed = true;
            return Task.CompletedTask;
        }, Options);

        await middleware.InvokeAsync(context);

        context.Response.Body.Position = 0;
        using var reader = new StreamReader(context.Response.Body);
        return (context.Response.StatusCode, passed, await reader.ReadToEndAsync());
    }

    [Fact]
    public async Task Missing_key_is_401_with_the_envelope()
    {
        var (status, passed, body) = await Run("/v1/ticket-types", null);

        Assert.Equal(401, status);
        Assert.False(passed);
        Assert.Contains("\"code\":\"UNAUTHORIZED\"", body);
    }

    [Theory]
    [InlineData("wrong")]
    [InlineData("a-key-of-exactly-the-wrong-length-but-long-enough-to-differ-from-both")]
    [InlineData("public-key-public-key-public-key-X")]
    public async Task Wrong_key_of_any_length_is_401_without_throwing(string key)
    {
        var (status, passed, _) = await Run("/v1/ticket-types", key);

        Assert.Equal(401, status);
        Assert.False(passed);
    }

    [Fact]
    public async Task Public_key_passes_on_a_public_scope_route()
    {
        var (_, passed, _) = await Run("/v1/ticket-types", PublicKey);

        Assert.True(passed);
    }

    [Fact]
    public async Task Public_key_on_an_internal_scope_endpoint_is_403()
    {
        var (status, passed, body) = await Run("/v1/orders/x/confirm", PublicKey, new InternalScopeAttribute());

        Assert.Equal(403, status);
        Assert.False(passed);
        Assert.Contains("\"code\":\"FORBIDDEN\"", body);
    }

    [Theory]
    [InlineData("/V1/INTERNAL/x")]
    [InlineData("//v1//internal/x")]
    [InlineData("/v1/internal/x")]
    [InlineData("/v1///Internal//x")]
    public async Task Public_key_on_an_internal_looking_path_is_403_even_without_metadata(string path)
    {
        var (status, passed, _) = await Run(path, PublicKey);

        Assert.Equal(403, status);
        Assert.False(passed);
    }

    [Theory]
    [InlineData("/v1/internal/x")]
    [InlineData("/v1/ticket-types")]
    public async Task Internal_key_passes_everywhere(string path)
    {
        var (_, passed, _) = await Run(path, InternalKey, new InternalScopeAttribute());

        Assert.True(passed);
    }

    [Fact]
    public async Task Public_endpoint_needs_no_key()
    {
        var (_, passed, _) = await Run("/health/live", null, new PublicEndpointAttribute());

        Assert.True(passed);
    }

    [Fact]
    public async Task Unmatched_path_still_requires_a_key()
    {
        var context = new DefaultHttpContext();
        context.Request.Path = "/v1/nope";
        context.Response.Body = new MemoryStream();
        var passed = false;
        var middleware = new ApiKeyMiddleware(_ =>
        {
            passed = true;
            return Task.CompletedTask;
        }, Options);

        await middleware.InvokeAsync(context);

        Assert.Equal(401, context.Response.StatusCode);
        Assert.False(passed);
    }
}
