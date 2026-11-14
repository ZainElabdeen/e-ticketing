using System.Diagnostics;
using System.Text.Json;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Routing;
using Serilog.Events;
using Serilog.Formatting;

namespace TicketService.Api.Http;

public static class LogSettings
{
    public const string Service = "ticket-service-dotnet";

    /// <summary>pino-style level names map to Serilog's minimum level.</summary>
    public static LogEventLevel Parse(string level) => level.ToLowerInvariant() switch
    {
        "trace" => LogEventLevel.Verbose,
        "debug" => LogEventLevel.Debug,
        "warn" => LogEventLevel.Warning,
        "error" => LogEventLevel.Error,
        "fatal" => LogEventLevel.Fatal,
        _ => LogEventLevel.Information,
    };
}

/// <summary>One flat JSON object per line with the spec section 7 names (timestamp, level, service, ...).</summary>
public sealed class JsonLogFormatter : ITextFormatter
{
    public void Format(LogEvent logEvent, TextWriter output)
    {
        using var stream = new MemoryStream();
        using (var writer = new Utf8JsonWriter(stream))
        {
            writer.WriteStartObject();
            writer.WriteString("timestamp", logEvent.Timestamp.UtcDateTime.ToString("yyyy-MM-dd'T'HH:mm:ss.fff'Z'"));
            writer.WriteString("level", LevelName(logEvent.Level));
            writer.WriteString("service", LogSettings.Service);
            foreach (var (name, value) in logEvent.Properties)
            {
                if (name is "timestamp" or "level" or "service" or "msg" or "err")
                {
                    continue;
                }
                writer.WritePropertyName(name);
                WriteValue(writer, value);
            }
            writer.WriteString("msg", logEvent.RenderMessage());
            if (logEvent.Exception is not null)
            {
                writer.WriteString("err", logEvent.Exception.ToString());
            }
            writer.WriteEndObject();
        }
        output.WriteLine(System.Text.Encoding.UTF8.GetString(stream.ToArray()));
    }

    private static void WriteValue(Utf8JsonWriter writer, LogEventPropertyValue value)
    {
        switch (value)
        {
            case ScalarValue { Value: null }:
                writer.WriteNullValue();
                break;
            case ScalarValue { Value: int or long or short or byte or double or float or decimal } scalar:
                writer.WriteRawValue(Convert.ToString(scalar.Value, System.Globalization.CultureInfo.InvariantCulture)!);
                break;
            case ScalarValue { Value: bool flag }:
                writer.WriteBooleanValue(flag);
                break;
            default:
                writer.WriteStringValue(value is ScalarValue s ? s.Value?.ToString() : value.ToString());
                break;
        }
    }

    private static string LevelName(LogEventLevel level) => level switch
    {
        LogEventLevel.Verbose => "trace",
        LogEventLevel.Debug => "debug",
        LogEventLevel.Information => "info",
        LogEventLevel.Warning => "warn",
        LogEventLevel.Error => "error",
        _ => "fatal",
    };
}

/// <summary>Logs one line per request. Never touches headers or bodies.</summary>
public sealed class RequestLoggingMiddleware(RequestDelegate next, Serilog.ILogger logger)
{
    public async Task InvokeAsync(HttpContext context)
    {
        var started = Stopwatch.GetTimestamp();
        try
        {
            await next(context);
        }
        finally
        {
            var elapsed = Stopwatch.GetElapsedTime(started).TotalMilliseconds;
            var statusCode = context.Response.StatusCode;
            logger
                .ForContext("correlationId", CorrelationId.Of(context))
                .ForContext("method", context.Request.Method)
                .ForContext("route", RouteOf(context))
                .ForContext("statusCode", statusCode)
                .ForContext("durationMs", Math.Round(elapsed, 3))
                .Write(statusCode >= 500 ? LogEventLevel.Error : LogEventLevel.Information, "request completed");
        }
    }

    /// <summary>The matched route pattern when there is one, else the path without its query.</summary>
    private static string RouteOf(HttpContext context) =>
        context.GetEndpoint() is RouteEndpoint { RoutePattern.RawText: { } pattern }
            ? "/" + pattern.TrimStart('/')
            : context.Request.Path.Value ?? string.Empty;
}
