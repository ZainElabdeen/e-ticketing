using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.AspNetCore.Http;

namespace TicketService.Api.Http;

public static class JsonSetup
{
    /// <summary>Strict in, JS-compatible out: camelCase, nulls written, unknown members and string numbers rejected.</summary>
    public static JsonSerializerOptions Create()
    {
        var options = new JsonSerializerOptions(JsonSerializerDefaults.Web);
        Apply(options);
        return options;
    }

    public static void Apply(JsonSerializerOptions options)
    {
        options.PropertyNamingPolicy = JsonNamingPolicy.CamelCase;
        options.PropertyNameCaseInsensitive = false;
        options.UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow;
        options.NumberHandling = JsonNumberHandling.Strict;
        options.DefaultIgnoreCondition = JsonIgnoreCondition.Never;
        options.Converters.Add(new UtcDateTimeConverter());
        options.Converters.Add(new UtcDateTimeOffsetConverter());
    }
}

/// <summary>Same text as JS <c>toISOString()</c>: <c>yyyy-MM-ddTHH:mm:ss.fffZ</c>, always UTC.</summary>
public sealed class UtcDateTimeConverter : JsonConverter<DateTime>
{
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public override DateTime Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateTime.Parse(reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AdjustToUniversal | DateTimeStyles.AssumeUniversal);

    public override void Write(Utf8JsonWriter writer, DateTime value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.ToUniversalTime().ToString(Format, CultureInfo.InvariantCulture));
}

public sealed class UtcDateTimeOffsetConverter : JsonConverter<DateTimeOffset>
{
    private const string Format = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public override DateTimeOffset Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options) =>
        DateTimeOffset.Parse(reader.GetString()!, CultureInfo.InvariantCulture, DateTimeStyles.AssumeUniversal);

    public override void Write(Utf8JsonWriter writer, DateTimeOffset value, JsonSerializerOptions options) =>
        writer.WriteStringValue(value.UtcDateTime.ToString(Format, CultureInfo.InvariantCulture));
}

/// <summary>
/// Validates a JSON body before MVC binds it, so a syntax error gets a fixed message (the parser
/// message quotes the payload) and the size limit applies even where the server does not enforce it.
/// </summary>
public sealed class JsonBodyGuardMiddleware(RequestDelegate next)
{
    public const long BodyLimitBytes = 102_400;

    public async Task InvokeAsync(HttpContext context)
    {
        var request = context.Request;
        if (!HttpMethods.IsGet(request.Method) && !HttpMethods.IsHead(request.Method)
            && request.ContentLength != 0 && request.HasJsonContentType())
        {
            var limit = context.Features.Get<Microsoft.AspNetCore.Http.Features.IHttpMaxRequestBodySizeFeature>()
                ?.MaxRequestBodySize ?? BodyLimitBytes;
            var bytes = await ReadAsync(request.Body, limit, context.RequestAborted);
            if (bytes.Length > 0)
            {
                try
                {
                    using var _ = JsonDocument.Parse(bytes);
                }
                catch (JsonException)
                {
                    throw new MalformedJsonException();
                }
                request.Body = new MemoryStream(bytes, writable: false);
            }
        }
        await next(context);
    }

    private static async Task<byte[]> ReadAsync(Stream body, long limit, CancellationToken token)
    {
        using var buffer = new MemoryStream();
        var chunk = new byte[81920];
        int read;
        while ((read = await body.ReadAsync(chunk, token)) > 0)
        {
            if (buffer.Length + read > limit)
            {
                throw new BadHttpRequestException("Request body too large.", StatusCodes.Status413PayloadTooLarge);
            }
            buffer.Write(chunk, 0, read);
        }
        return buffer.ToArray();
    }
}
