using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;

namespace TicketService.Api.Http;

public sealed record ErrorEnvelope(int StatusCode, string Code, string Message, string CorrelationId);

/// <summary>The single writer of error bodies, so no other shape can reach a client.</summary>
public static class ErrorWriter
{
    private static readonly JsonSerializerOptions Options = new(JsonSerializerDefaults.Web)
    {
        DefaultIgnoreCondition = JsonIgnoreCondition.Never,
    };

    public static Task WriteAsync(HttpContext context, int statusCode, string code, string message)
    {
        var envelope = new ErrorEnvelope(statusCode, code, message, CorrelationId.Of(context));
        context.Response.StatusCode = statusCode;
        context.Response.ContentType = "application/json; charset=utf-8";
        context.Response.ContentLength = null;
        return context.Response.WriteAsync(JsonSerializer.Serialize(envelope, Options));
    }
}

/// <summary>Fixed text only: the parser message can quote the payload (a card number, a CVC).</summary>
public sealed class MalformedJsonException() : Domain.DomainException("Malformed JSON body")
{
    public override string Code => "VALIDATION_ERROR";
    public override int StatusCode => 400;
}

public sealed class RouteNotFoundException() : Domain.DomainException("Route not found")
{
    public override string Code => "NOT_FOUND";
    public override int StatusCode => 404;
}

/// <summary>Model-binding failures (unknown field, wrong type, failed validation) as the envelope.</summary>
public static class ModelStateEnvelope
{
    public static Microsoft.AspNetCore.Mvc.IActionResult Create(Microsoft.AspNetCore.Mvc.ActionContext context)
    {
        // Never the exception message: the JSON parser quotes request data in it.
        var messages = context.ModelState
            .Where(entry => entry.Value is { Errors.Count: > 0 })
            .SelectMany(entry => entry.Value!.Errors.Select(error =>
                !string.IsNullOrEmpty(error.ErrorMessage) ? error.ErrorMessage : $"{DisplayKey(entry.Key)} is invalid"))
            .Distinct();
        var message = string.Join("; ", messages);
        return new EnvelopeResult(400, "VALIDATION_ERROR", message.Length > 0 ? message : "Invalid request");
    }

    private static string DisplayKey(string key) => key is "" or "$" ? "request body" : key.TrimStart('$', '.');
}

public sealed class EnvelopeResult(int status, string code, string message) : Microsoft.AspNetCore.Mvc.IActionResult
{
    public Task ExecuteResultAsync(Microsoft.AspNetCore.Mvc.ActionContext context) =>
        ErrorWriter.WriteAsync(context.HttpContext, status, code, message);
}
