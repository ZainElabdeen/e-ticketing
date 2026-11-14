using Microsoft.EntityFrameworkCore;
using Npgsql;
using TicketService.Api.Config;
using TicketService.Api.Infrastructure;

namespace TicketService.Api;

public partial class Program
{
    public static int Main(string[] args)
    {
        WebApplication app;
        try
        {
            app = BuildApp(args);
        }
        catch (InvalidOperationException ex) when (ex.Message.StartsWith("Invalid environment:", StringComparison.Ordinal))
        {
            Console.Error.WriteLine(ex.Message);
            return 1;
        }

        app.Run();
        return 0;
    }

    /// <summary>
    /// Builds the app. Configuration comes from <paramref name="envOverride"/> when given, otherwise
    /// from the host configuration (environment variables, command line, test settings).
    /// </summary>
    public static WebApplication BuildApp(string[] args, IDictionary<string, string?>? envOverride = null)
    {
        var builder = WebApplication.CreateBuilder(args);

        // Resolved lazily so settings a test host adds late are visible; validated eagerly below.
        builder.Services.AddSingleton(sp => EnvLoader.Load(envOverride ?? ReadEnv(sp.GetRequiredService<IConfiguration>())));
        builder.Services.AddSingleton(sp =>
            new NpgsqlDataSourceBuilder(sp.GetRequiredService<TicketServiceOptions>().ConnectionString).Build());
        builder.Services.AddDbContext<TicketsDbContext>((sp, options) =>
            options.UseNpgsql(sp.GetRequiredService<NpgsqlDataSource>()));
        builder.Services.AddControllers();
        builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(15));
        builder.WebHost.ConfigureKestrel((_, kestrel) =>
            kestrel.ListenAnyIP(kestrel.ApplicationServices.GetRequiredService<TicketServiceOptions>().Port));

        var app = builder.Build();
        app.Services.GetRequiredService<TicketServiceOptions>();
        app.MapControllers();
        return app;
    }

    private static Dictionary<string, string?> ReadEnv(IConfiguration configuration) =>
        EnvLoader.Keys.ToDictionary(key => key, key => configuration[key]);
}
