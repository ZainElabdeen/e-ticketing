using Microsoft.AspNetCore.Http;

namespace TicketService.Api.Http;

public static class CorrelationId
{
    public const string Header = "X-Correlation-Id";
    private const string ItemKey = "correlation-id";

    /// <summary>Resolves the ID once per request. A header that is not a UUID is discarded: it would reach the logs.</summary>
    public static string Of(HttpContext context)
    {
        if (context.Items[ItemKey] is string cached)
        {
            return cached;
        }
        var candidate = context.Request.Headers[Header].FirstOrDefault();
        var id = candidate is not null && Guid.TryParseExact(candidate, "D", out _)
            ? candidate
            : Guid.NewGuid().ToString("D");
        context.Items[ItemKey] = id;
        return id;
    }
}

public sealed class CorrelationIdMiddleware(RequestDelegate next)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var id = CorrelationId.Of(context);
        context.Response.Headers[CorrelationId.Header] = id;
        using (Serilog.Context.LogContext.PushProperty("correlationId", id))
        {
            await next(context);
        }
    }
}
