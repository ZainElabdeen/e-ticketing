using Microsoft.Extensions.Hosting;
using Serilog.Context;
using TicketService.Api.Config;

namespace TicketService.Api.Infrastructure;

/// <summary>One expiry run, reachable without the hosted service (the job and the tests both call it).</summary>
public sealed class OrderExpiryRunner(OrdersRepository repository, TicketServiceOptions options)
{
    /// <summary>Expires due orders, up to ORDER_EXPIRY_BATCH_SIZE. Returns how many.</summary>
    public async Task<int> RunOnceAsync(CancellationToken ct)
    {
        var expired = 0;
        // Shutdown stops between orders; an order in progress finishes so its transaction is never cut short.
        while (expired < options.ExpiryBatchSize && !ct.IsCancellationRequested)
        {
            if (await repository.ExpireOneAsync(CancellationToken.None) is null)
            {
                break;
            }
            expired++;
        }
        return expired;
    }
}

/// <summary>Releases the reservations of PENDING orders whose time has passed.</summary>
public sealed class OrderExpiryJob(IServiceScopeFactory scopes, TicketServiceOptions options, Serilog.ILogger logger)
    : BackgroundService
{
    public const string CorrelationId = "job:order-expiry";

    private int _running;
    private Task _inFlight = Task.CompletedTask;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(TimeSpan.FromSeconds(options.ExpiryIntervalSeconds));
        try
        {
            while (await timer.WaitForNextTickAsync(stoppingToken))
            {
                // Not awaited: a tick that arrives while a run is still going finds the flag set and is skipped.
                if (Interlocked.CompareExchange(ref _running, 1, 0) == 0)
                {
                    _inFlight = RunAsync(stoppingToken);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Shutting down.
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        await _inFlight.WaitAsync(cancellationToken);
    }

    /// <summary>One run, started by a tick that claimed the running flag. Never throws.</summary>
    private async Task RunAsync(CancellationToken stoppingToken)
    {
        using var _ = LogContext.PushProperty("correlationId", CorrelationId);
        try
        {
            using var scope = scopes.CreateScope();
            var expired = await scope.ServiceProvider.GetRequiredService<OrderExpiryRunner>().RunOnceAsync(stoppingToken);
            if (expired > 0)
            {
                logger.Information("expired {Expired} unpaid orders", expired);
            }
        }
        catch (Exception ex)
        {
            logger.Error(ex, "order expiry run failed");
        }
        finally
        {
            Interlocked.Exchange(ref _running, 0);
        }
    }
}
