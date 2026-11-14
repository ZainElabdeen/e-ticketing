using Microsoft.AspNetCore.Http;
using TicketService.Api.Domain;

namespace TicketService.Api.Http;

/// <summary>Catches everything and is the only place an error body is produced.</summary>
public sealed class ErrorEnvelopeMiddleware(RequestDelegate next, Serilog.ILogger logger)
{
    private static readonly HashSet<string> HealthPaths = new(StringComparer.Ordinal) { "/health/live", "/health/ready" };

    public async Task InvokeAsync(HttpContext context)
    {
        try
        {
            await next(context);
        }
        catch (Exception ex) when (!context.Response.HasStarted && ex is not OperationCanceledException)
        {
            var (status, code, message) = Classify(ex, context);
            await ErrorWriter.WriteAsync(context, status, code, message);
            return;
        }

        // Bare status results (404 from routing, 405, 415 from MVC) carry no body: give them the envelope.
        var response = context.Response;
        if (!response.HasStarted && response.StatusCode >= 400 && response.ContentLength is null
            && response.ContentType is null && !HealthPaths.Contains(context.Request.Path.Value ?? string.Empty))
        {
            var (status, code, message) = response.StatusCode switch
            {
                // Express answers an unsupported method or media type through its catch-all or an empty body:
                // 404, and a 400 validation failure (the body is treated as empty).
                404 or 405 => (404, "NOT_FOUND", "Route not found"),
                415 => (400, "VALIDATION_ERROR", "Request body must be application/json"),
                var s when s >= 500 => (500, "INTERNAL_ERROR", "Internal server error"),
                var s => (s, GenericCode(s), "Bad request"),
            };
            await ErrorWriter.WriteAsync(context, status, code, message);
        }
    }

    private (int Status, string Code, string Message) Classify(Exception exception, HttpContext context)
    {
        switch (exception)
        {
            case DomainException domain:
                return (domain.StatusCode, domain.Code, domain.Message);
            case Microsoft.AspNetCore.Http.BadHttpRequestException { StatusCode: >= 400 and < 500 } bad:
                // Fixed text: the framework message can quote request data.
                logger.ForContext("correlationId", CorrelationId.Of(context)).Warning("rejected request, status {Status}", bad.StatusCode);
                return (bad.StatusCode, GenericCode(bad.StatusCode),
                    bad.StatusCode == 413 ? "Request body too large" : "Bad request");
            default:
                logger.ForContext("correlationId", CorrelationId.Of(context)).Error(exception, "unhandled exception");
                return (500, "INTERNAL_ERROR", "Internal server error");
        }
    }

    private static string GenericCode(int status) => status switch
    {
        413 => "PAYLOAD_TOO_LARGE",
        415 => "UNSUPPORTED_MEDIA_TYPE",
        429 => "RATE_LIMITED",
        _ => "BAD_REQUEST",
    };
}
