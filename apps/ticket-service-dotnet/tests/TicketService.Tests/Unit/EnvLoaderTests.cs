using Serilog.Events;
using TicketService.Api.Config;
using TicketService.Api.Http;

namespace TicketService.Tests.Unit;

[Trait("Category", "Unit")]
public sealed class EnvLoaderTests
{
    private const string PublicKey = "public-key-public-key-public-key-1";
    private const string InternalKey = "internal-key-internal-key-intern-2";

    private static Dictionary<string, string?> Valid() => new()
    {
        ["DATABASE_URL"] = "postgresql://tickets_app:secret@db.local:5433/eticketing?schema=tickets",
        ["PUBLIC_API_KEY_TICKET"] = PublicKey,
        ["INTERNAL_API_KEY_TICKET"] = InternalKey,
    };

    [Fact]
    public void Applies_defaults()
    {
        var options = EnvLoader.Load(Valid());

        Assert.Equal(3001, options.Port);
        Assert.Equal(15, options.OrderTtlMinutes);
        Assert.Equal(60, options.ExpiryIntervalSeconds);
        Assert.Equal(100, options.ExpiryBatchSize);
        Assert.True(options.ExpiryEnabled);
        Assert.False(options.SwaggerEnabled);
        Assert.Equal("info", options.LogLevel);
        Assert.Equal(PublicKey, options.PublicKey);
        Assert.Equal(InternalKey, options.InternalKey);
    }

    [Fact]
    public void Parses_false_as_false()
    {
        var env = Valid();
        env["ORDER_EXPIRY_ENABLED"] = "false";
        env["SWAGGER_ENABLED"] = "true";

        var options = EnvLoader.Load(env);

        Assert.False(options.ExpiryEnabled);
        Assert.True(options.SwaggerEnabled);
    }

    [Fact]
    public void Rejects_a_short_key_naming_it()
    {
        var env = Valid();
        env["PUBLIC_API_KEY_TICKET"] = "short";

        var ex = Assert.Throws<InvalidOperationException>(() => EnvLoader.Load(env));

        Assert.Contains("PUBLIC_API_KEY_TICKET", ex.Message);
    }

    [Fact]
    public void Rejects_equal_keys_naming_the_internal_one()
    {
        var env = Valid();
        env["INTERNAL_API_KEY_TICKET"] = PublicKey;

        var ex = Assert.Throws<InvalidOperationException>(() => EnvLoader.Load(env));

        Assert.Contains("INTERNAL_API_KEY_TICKET", ex.Message);
    }

    [Fact]
    public void Rejects_a_missing_database_url()
    {
        var env = Valid();
        env.Remove("DATABASE_URL");

        var ex = Assert.Throws<InvalidOperationException>(() => EnvLoader.Load(env));

        Assert.Contains("DATABASE_URL", ex.Message);
    }

    [Fact]
    public void Translates_database_url_to_an_npgsql_connection_string()
    {
        var options = EnvLoader.Load(Valid());

        var builder = new Npgsql.NpgsqlConnectionStringBuilder(options.ConnectionString);
        Assert.Equal("db.local", builder.Host);
        Assert.Equal(5433, builder.Port);
        Assert.Equal("eticketing", builder.Database);
        Assert.Equal("tickets_app", builder.Username);
        Assert.Equal("secret", builder.Password);
        Assert.Equal("tickets", builder.SearchPath);
        Assert.Equal(5, builder.Timeout);
        Assert.Equal("tickets", options.Schema);
    }

    [Fact]
    public void Decodes_a_url_encoded_password()
    {
        var env = Valid();
        env["DATABASE_URL"] = "postgresql://tickets_app:p%40ss%2Fw%3Ard%25@db:5432/eticketing?schema=tickets";

        var options = EnvLoader.Load(env);

        Assert.Equal("p@ss/w:rd%", new Npgsql.NpgsqlConnectionStringBuilder(options.ConnectionString).Password);
    }

    [Fact]
    public void Caps_the_pool_at_ten_like_the_nest_service()
    {
        var options = EnvLoader.Load(Valid());

        Assert.Equal(10, new Npgsql.NpgsqlConnectionStringBuilder(options.ConnectionString).MaxPoolSize);
    }

    [Fact]
    public void Honours_the_prisma_connection_limit()
    {
        var env = Valid();
        env["DATABASE_URL"] = "postgresql://tickets_app:secret@db.local:5433/eticketing?schema=tickets&connection_limit=5";

        var options = EnvLoader.Load(env);

        Assert.Equal(5, new Npgsql.NpgsqlConnectionStringBuilder(options.ConnectionString).MaxPoolSize);
        Assert.Equal("tickets", options.Schema);
    }

    [Theory]
    [InlineData("0")]
    [InlineData("-3")]
    [InlineData("abc")]
    public void Ignores_an_invalid_connection_limit(string limit)
    {
        var env = Valid();
        env["DATABASE_URL"] = $"postgresql://tickets_app:secret@db.local:5433/eticketing?schema=tickets&connection_limit={limit}";

        var options = EnvLoader.Load(env);

        Assert.Equal(10, new Npgsql.NpgsqlConnectionStringBuilder(options.ConnectionString).MaxPoolSize);
    }

    [Fact]
    public void Bounds_lock_waits_with_a_ten_second_command_timeout()
    {
        var options = EnvLoader.Load(Valid());

        Assert.Equal(10, new Npgsql.NpgsqlConnectionStringBuilder(options.ConnectionString).CommandTimeout);
    }

    [Theory]
    [InlineData("trace", LogEventLevel.Verbose)]
    [InlineData("debug", LogEventLevel.Debug)]
    [InlineData("info", LogEventLevel.Information)]
    [InlineData("warn", LogEventLevel.Warning)]
    [InlineData("error", LogEventLevel.Error)]
    [InlineData("fatal", LogEventLevel.Fatal)]
    public void Maps_pino_level_names(string name, LogEventLevel expected)
    {
        Assert.Equal(expected, LogSettings.Parse(name));
    }

    [Fact]
    public void Silent_sits_above_every_level_so_nothing_is_written()
    {
        Assert.True(LogSettings.Parse("silent") > LogEventLevel.Fatal);
    }

    [Fact]
    public void Lists_every_invalid_variable_in_one_error()
    {
        var env = new Dictionary<string, string?>
        {
            ["PORT"] = "abc",
            ["PUBLIC_API_KEY_TICKET"] = "short",
            ["INTERNAL_API_KEY_TICKET"] = "short",
            ["ORDER_EXPIRY_BATCH_SIZE"] = "5000",
            ["LOG_LEVEL"] = "loud",
            ["SWAGGER_ENABLED"] = "maybe",
        };

        var ex = Assert.Throws<InvalidOperationException>(() => EnvLoader.Load(env));

        foreach (var name in new[]
                 {
                     "PORT", "DATABASE_URL", "PUBLIC_API_KEY_TICKET", "INTERNAL_API_KEY_TICKET",
                     "ORDER_EXPIRY_BATCH_SIZE", "LOG_LEVEL", "SWAGGER_ENABLED",
                 })
        {
            Assert.Contains(name, ex.Message);
        }
    }
}
