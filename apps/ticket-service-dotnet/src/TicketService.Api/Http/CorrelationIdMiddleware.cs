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
        var id = candidate is not null && Guid.TryParseExact(candidate, "D", out var parsed)
            ? parsed.ToString("D")
            : Guid.NewGuid().ToString("D");
        context.Items[ItemKey] = id;
        return id;
    }
}

public sealed class CorrelationIdMiddleware(RequestDelegate next)
{
    public Task InvokeAsync(HttpContext context)
    {
        context.Response.Headers[CorrelationId.Header] = CorrelationId.Of(context);
        return next(context);
    }
}
