using Npgsql;

namespace TicketService.Api.Config;

/// <summary>
/// Same variables, defaults and rules as the NestJS service's validateEnv. Throws one
/// exception that lists every invalid variable.
/// </summary>
public static class EnvLoader
{
    public static readonly string[] Keys =
    [
        "PORT", "DATABASE_URL", "PUBLIC_API_KEY_TICKET", "INTERNAL_API_KEY_TICKET", "SWAGGER_ENABLED",
        "LOG_LEVEL", "ORDER_TTL_MINUTES", "ORDER_EXPIRY_INTERVAL_SECONDS", "ORDER_EXPIRY_BATCH_SIZE",
        "ORDER_EXPIRY_ENABLED",
    ];

    private static readonly string[] LogLevels = ["fatal", "error", "warn", "info", "debug", "trace", "silent"];
    private const int MinKeyLength = 32;

    public static TicketServiceOptions Load(IDictionary<string, string?> env)
    {
        var errors = new List<string>();

        var port = ReadInt(env, "PORT", 3001, 1, 65535, errors);
        var swagger = ReadBool(env, "SWAGGER_ENABLED", false, errors);
        var logLevel = Get(env, "LOG_LEVEL") ?? "info";
        if (!LogLevels.Contains(logLevel))
        {
            errors.Add($"LOG_LEVEL must be one of the following values: {string.Join(", ", LogLevels)}");
        }

        var ttl = ReadInt(env, "ORDER_TTL_MINUTES", 15, 1, int.MaxValue, errors);
        var interval = ReadInt(env, "ORDER_EXPIRY_INTERVAL_SECONDS", 60, 1, int.MaxValue, errors);
        var batch = ReadInt(env, "ORDER_EXPIRY_BATCH_SIZE", 100, 1, 1000, errors);
        var expiryEnabled = ReadBool(env, "ORDER_EXPIRY_ENABLED", true, errors);

        var connectionString = "";
        var schema = "";
        var databaseUrl = Get(env, "DATABASE_URL");
        if (string.IsNullOrEmpty(databaseUrl))
        {
            errors.Add("DATABASE_URL should not be empty");
        }
        else if (!TryTranslateDatabaseUrl(databaseUrl, out connectionString, out schema))
        {
            errors.Add("DATABASE_URL must be a postgresql://user:password@host:port/database URL");
        }

        var publicKey = Get(env, "PUBLIC_API_KEY_TICKET") ?? "";
        if (publicKey.Length < MinKeyLength)
        {
            errors.Add($"PUBLIC_API_KEY_TICKET must be longer than or equal to {MinKeyLength} characters");
        }

        var internalKey = Get(env, "INTERNAL_API_KEY_TICKET") ?? "";
        if (internalKey.Length < MinKeyLength)
        {
            errors.Add($"INTERNAL_API_KEY_TICKET must be longer than or equal to {MinKeyLength} characters");
        }
        if (internalKey == publicKey)
        {
            errors.Add("INTERNAL_API_KEY_TICKET must differ from PUBLIC_API_KEY_TICKET");
        }

        if (errors.Count > 0)
        {
            throw new InvalidOperationException(
                $"Invalid environment:{Environment.NewLine}{string.Join(Environment.NewLine, errors.Select(e => $"  - {e}"))}");
        }

        return new TicketServiceOptions(port, connectionString, schema, publicKey, internalKey, swagger, logLevel,
            ttl, interval, batch, expiryEnabled);
    }

    /// <summary>Prisma-style <c>postgresql://user:pw@host:port/db?schema=tickets</c> to an Npgsql connection string.</summary>
    public static bool TryTranslateDatabaseUrl(string url, out string connectionString, out string schema)
    {
        connectionString = "";
        schema = "";
        if (!Uri.TryCreate(url, UriKind.Absolute, out var uri)
            || (uri.Scheme != "postgresql" && uri.Scheme != "postgres")
            || string.IsNullOrEmpty(uri.Host))
        {
            return false;
        }

        var database = Uri.UnescapeDataString(uri.AbsolutePath.TrimStart('/'));
        var userInfo = uri.UserInfo.Split(':', 2);
        if (database.Length == 0 || userInfo[0].Length == 0)
        {
            return false;
        }

        schema = "public";
        foreach (var pair in uri.Query.TrimStart('?').Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var kv = pair.Split('=', 2);
            if (kv[0] == "schema" && kv.Length == 2 && kv[1].Length > 0)
            {
                schema = Uri.UnescapeDataString(kv[1]);
            }
        }

        var builder = new NpgsqlConnectionStringBuilder
        {
            Host = uri.Host,
            Port = uri.Port > 0 ? uri.Port : 5432,
            Database = database,
            Username = Uri.UnescapeDataString(userInfo[0]),
            Password = userInfo.Length > 1 ? Uri.UnescapeDataString(userInfo[1]) : null,
            SearchPath = schema,
            Timeout = 5,
        };
        connectionString = builder.ConnectionString;
        return true;
    }

    private static string? Get(IDictionary<string, string?> env, string key) =>
        env.TryGetValue(key, out var value) ? value : null;

    private static int ReadInt(IDictionary<string, string?> env, string key, int fallback, int min, int max,
        List<string> errors)
    {
        var raw = Get(env, key);
        if (raw is null)
        {
            return fallback;
        }
        if (!int.TryParse(raw, System.Globalization.NumberStyles.None, System.Globalization.CultureInfo.InvariantCulture,
                out var value))
        {
            errors.Add($"{key} must be an integer number");
            return fallback;
        }
        if (value < min)
        {
            errors.Add($"{key} must not be less than {min}");
        }
        else if (value > max)
        {
            errors.Add($"{key} must not be greater than {max}");
        }
        return value;
    }

    private static bool ReadBool(IDictionary<string, string?> env, string key, bool fallback, List<string> errors)
    {
        var raw = Get(env, key);
        switch (raw)
        {
            case null:
                return fallback;
            case "true":
                return true;
            case "false":
                return false;
            default:
                errors.Add($"{key} must be a boolean value");
                return fallback;
        }
    }
}
