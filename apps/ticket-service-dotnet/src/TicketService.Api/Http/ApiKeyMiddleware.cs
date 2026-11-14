using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.Http;
using TicketService.Api.Config;

namespace TicketService.Api.Http;

/// <summary>
/// Two key scopes. The public key is accepted everywhere except internal routes; the internal key everywhere.
/// Runs after routing so endpoint metadata is visible; an unmatched path has no endpoint and still needs a key.
/// </summary>
public sealed class ApiKeyMiddleware(RequestDelegate next, TicketServiceOptions options)
{
    public const string Header = "X-Api-Key";
    private const string InternalPrefix = "/v1/internal/";

    private readonly byte[] _publicKey = Encoding.UTF8.GetBytes(options.PublicKey);
    private readonly byte[] _internalKey = Encoding.UTF8.GetBytes(options.InternalKey);

    public async Task InvokeAsync(HttpContext context)
    {
        var metadata = context.GetEndpoint()?.Metadata;
        if (metadata?.GetMetadata<PublicEndpointAttribute>() is not null)
        {
            await next(context);
            return;
        }

        var presented = context.Request.Headers[Header].FirstOrDefault();
        if (string.IsNullOrEmpty(presented))
        {
            await Reject(context, 401, "UNAUTHORIZED", "Missing or invalid API key");
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(presented);
        var isInternal = SafeEqual(bytes, _internalKey);
        if (!isInternal && !SafeEqual(bytes, _publicKey))
        {
            await Reject(context, 401, "UNAUTHORIZED", "Missing or invalid API key");
            return;
        }

        // Defense in depth: the path check survives a route that forgot [InternalScope].
        var internalRoute = metadata?.GetMetadata<InternalScopeAttribute>() is not null
            || Normalize(context.Request.Path.Value).StartsWith(InternalPrefix, StringComparison.Ordinal);
        if (internalRoute && !isInternal)
        {
            await Reject(context, 403, "FORBIDDEN", "This key is not allowed on internal routes");
            return;
        }

        await next(context);
    }

    private static Task Reject(HttpContext context, int status, string code, string message) =>
        ErrorWriter.WriteAsync(context, status, code, message);

    /// <summary>Lowercased, repeated slashes collapsed.</summary>
    private static string Normalize(string? path)
    {
        var lower = (path ?? string.Empty).ToLowerInvariant();
        var builder = new StringBuilder(lower.Length);
        foreach (var c in lower)
        {
            if (c != '/' || builder.Length == 0 || builder[^1] != '/')
            {
                builder.Append(c);
            }
        }
        return builder.ToString();
    }

    private static bool SafeEqual(byte[] left, byte[] right) =>
        left.Length == right.Length && CryptographicOperations.FixedTimeEquals(left, right);
}
