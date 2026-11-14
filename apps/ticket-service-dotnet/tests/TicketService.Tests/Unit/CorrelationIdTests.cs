using Microsoft.AspNetCore.Http;
using TicketService.Api.Http;

namespace TicketService.Tests.Unit;

[Trait("Category", "Unit")]
public sealed class CorrelationIdTests
{
    private static DefaultHttpContext ContextWith(string? header)
    {
        var context = new DefaultHttpContext();
        if (header is not null)
        {
            context.Request.Headers[CorrelationId.Header] = header;
        }
        return context;
    }

    [Fact]
    public void A_uuid_header_is_kept()
    {
        var id = Guid.NewGuid().ToString();

        Assert.Equal(id, CorrelationId.Of(ContextWith(id)));
    }

    [Fact]
    public void An_uppercase_uuid_is_echoed_as_sent()
    {
        var id = Guid.NewGuid().ToString().ToUpperInvariant();

        Assert.Equal(id, CorrelationId.Of(ContextWith(id)));
    }

    [Fact]
    public void A_non_uuid_header_is_replaced_by_a_new_uuid()
    {
        var resolved = CorrelationId.Of(ContextWith("not-a-uuid"));

        Assert.NotEqual("not-a-uuid", resolved);
        Assert.True(Guid.TryParseExact(resolved, "D", out _));
    }

    [Fact]
    public void A_missing_header_gets_a_new_uuid()
    {
        Assert.True(Guid.TryParseExact(CorrelationId.Of(ContextWith(null)), "D", out _));
    }

    [Fact]
    public void The_id_is_resolved_once_per_request()
    {
        var context = ContextWith(null);

        Assert.Equal(CorrelationId.Of(context), CorrelationId.Of(context));
    }

    [Fact]
    public async Task The_middleware_sets_the_response_header()
    {
        var context = ContextWith(null);

        await new CorrelationIdMiddleware(_ => Task.CompletedTask).InvokeAsync(context);

        Assert.Equal(CorrelationId.Of(context), context.Response.Headers[CorrelationId.Header].ToString());
    }
}
