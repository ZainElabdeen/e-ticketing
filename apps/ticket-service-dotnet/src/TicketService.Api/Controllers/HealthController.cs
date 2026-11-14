using Microsoft.AspNetCore.Mvc;
using Npgsql;

namespace TicketService.Api.Controllers;

[ApiController]
[Route("health")]
public sealed class HealthController(NpgsqlDataSource dataSource) : ControllerBase
{
    private static readonly TimeSpan DbTimeout = TimeSpan.FromSeconds(2);

    /// <summary>Liveness never touches the database.</summary>
    [HttpGet("live")]
    public IActionResult Live() => Ok(new { status = "ok" });

    [HttpGet("ready")]
    public async Task<IActionResult> Ready(CancellationToken requestAborted)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(requestAborted);
        timeout.CancelAfter(DbTimeout);
        try
        {
            await using var connection = await dataSource.OpenConnectionAsync(timeout.Token);
            await using var command = new NpgsqlCommand("SELECT 1", connection);
            await command.ExecuteScalarAsync(timeout.Token);
            return Ok(new { status = "ok" });
        }
        catch (Exception) when (!requestAborted.IsCancellationRequested)
        {
            return StatusCode(StatusCodes.Status503ServiceUnavailable,
                new { status = "error", details = new { database = new { status = "down" } } });
        }
    }
}
