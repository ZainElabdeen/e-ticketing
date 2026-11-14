using FluentValidation;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Npgsql;
using Serilog;
using Serilog.Core;
using Serilog.Events;
using TicketService.Api.Application;
using TicketService.Api.Config;
using TicketService.Api.Http;
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
        builder.Services.AddValidatorsFromAssemblyContaining<Program>();
        builder.Services.AddScoped<TicketTypesRepository>();
        builder.Services.AddScoped<OrdersRepository>();
        builder.Services.AddScoped<TicketTypesService>();
        builder.Services.AddScoped<OrdersService>();
        builder.Host.UseSerilog((_, services, logger) =>
        {
            var options = services.GetRequiredService<TicketServiceOptions>();
            logger
                .Enrich.FromLogContext()
                .MinimumLevel.Is(LogSettings.Parse(options.LogLevel))
                .MinimumLevel.Override("Microsoft", LogEventLevel.Warning)
                .WriteTo.Console(new JsonLogFormatter());
            // Test seam: sinks registered in DI receive every event too.
            foreach (var sink in services.GetServices<ILogEventSink>())
            {
                logger.WriteTo.Sink(sink);
            }
        });
        builder.Services
            .AddControllers()
            .AddJsonOptions(json =>
            {
                JsonSetup.Apply(json.JsonSerializerOptions);
                // Parser text names CLR types and line numbers.
                json.AllowInputFormatterExceptionMessages = false;
            });
        builder.Services.Configure<ApiBehaviorOptions>(api =>
        {
            // No ProblemDetails anywhere: bare client errors reach the envelope middleware instead.
            api.SuppressMapClientErrors = true;
            api.InvalidModelStateResponseFactory = ModelStateEnvelope.Create;
        });
        builder.Services.Configure<HostOptions>(o => o.ShutdownTimeout = TimeSpan.FromSeconds(15));
        builder.WebHost.ConfigureKestrel((_, kestrel) =>
            {
                kestrel.Limits.MaxRequestBodySize = JsonBodyGuardMiddleware.BodyLimitBytes;
                kestrel.ListenAnyIP(kestrel.ApplicationServices.GetRequiredService<TicketServiceOptions>().Port);
            });

        var app = builder.Build();
        var config = app.Services.GetRequiredService<TicketServiceOptions>();

        app.UseMiddleware<CorrelationIdMiddleware>();
        app.UseMiddleware<RequestLoggingMiddleware>();
        app.UseMiddleware<ErrorEnvelopeMiddleware>();
        app.UseRouting();
        app.UseDocs(config.SwaggerEnabled);
        app.UseMiddleware<ApiKeyMiddleware>();
        app.UseMiddleware<JsonBodyGuardMiddleware>();
        app.MapControllers();
        // Unmatched paths land here, so the key check above still runs: 401 without a key, 404 with one.
        app.MapFallback(_ => throw new RouteNotFoundException());
        return app;
    }

    private static Dictionary<string, string?> ReadEnv(IConfiguration configuration) =>
        EnvLoader.Keys.ToDictionary(key => key, key => configuration[key]);
}
