using TicketService.Api;

namespace TicketService.Tests.Unit;

[Trait("Category", "Unit")]
[Collection("console")]
public sealed class ProgramConfigTests
{
    private static Dictionary<string, string?> Valid() => new()
    {
        // Nothing connects at build time, so the host does not need to exist.
        ["DATABASE_URL"] = "postgresql://tickets_app:x@127.0.0.1:1/eticketing?schema=tickets",
        ["PUBLIC_API_KEY_TICKET"] = "public-key-public-key-public-key-1",
        ["INTERNAL_API_KEY_TICKET"] = "internal-key-internal-key-intern-2",
    };

    [Fact]
    public void BuildApp_fails_fast_naming_the_missing_variables()
    {
        var ex = Assert.Throws<InvalidOperationException>(
            () => Program.BuildApp([], new Dictionary<string, string?>()));

        Assert.StartsWith("Invalid environment", ex.Message);
        Assert.Contains("DATABASE_URL", ex.Message);
    }

    [Fact]
    public async Task BuildApp_builds_with_valid_config_without_touching_the_database()
    {
        await using var app = Program.BuildApp([], Valid());

        Assert.NotNull(app);
    }

    [Fact]
    public void Main_prints_the_error_to_stderr_and_returns_1_on_invalid_config()
    {
        // Main reads the process environment; skip the assertion if a real config is present.
        if (Environment.GetEnvironmentVariable("DATABASE_URL") is not null)
        {
            return;
        }

        var original = Console.Error;
        var captured = new StringWriter();
        Console.SetError(captured);
        try
        {
            Assert.Equal(1, Program.Main([]));
        }
        finally
        {
            Console.SetError(original);
        }

        Assert.Contains("Invalid environment", captured.ToString());
    }
}
