using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using TicketService.Api;

namespace TicketService.Tests.Support;

public sealed class TicketServiceFactory : WebApplicationFactory<Program>
{
    public const string DefaultPublicKey = "test-public-key-test-public-key-0001";
    public const string DefaultInternalKey = "test-internal-key-test-internal-0002";

    private readonly Dictionary<string, string?> _settings;

    public TicketServiceFactory(PostgresFixture db, IDictionary<string, string?>? overrides = null)
    {
        _settings = new Dictionary<string, string?>
        {
            ["DATABASE_URL"] = db.UrlFor("tickets_app"),
            ["PUBLIC_API_KEY_TICKET"] = DefaultPublicKey,
            ["INTERNAL_API_KEY_TICKET"] = DefaultInternalKey,
            ["ORDER_EXPIRY_ENABLED"] = "false",
        };
        foreach (var (key, value) in overrides ?? new Dictionary<string, string?>())
        {
            _settings[key] = value;
        }
    }

    public string PublicKey => _settings["PUBLIC_API_KEY_TICKET"]!;
    public string InternalKey => _settings["INTERNAL_API_KEY_TICKET"]!;

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        foreach (var (key, value) in _settings)
        {
            builder.UseSetting(key, value);
        }
    }
}
