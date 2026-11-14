using Microsoft.AspNetCore.Mvc;
using TicketService.Api.Domain;
using TicketService.Api.Http;

namespace TicketService.Tests.Support;

public sealed record EchoRequest(int Quantity);

/// <summary>Test-only routes that exercise the HTTP pipeline before the real controllers exist.</summary>
[ApiController]
public sealed class TestEndpointsController : ControllerBase
{
    [HttpGet("v1/test/ok")]
    public IActionResult Ok_() => Ok(new { ok = true });

    [HttpPost("v1/test/echo")]
    public IActionResult Echo([FromBody] EchoRequest request) => Ok(new { quantity = request.Quantity });

    [HttpGet("v1/test/boom")]
    public IActionResult Boom() => throw new InvalidOperationException("secret stack detail");

    [HttpGet("v1/test/quota")]
    public IActionResult Quota() => throw new QuotaExceededException("GOLD");

    [InternalScope]
    [HttpPost("v1/internal/test")]
    public IActionResult InternalOnly() => Ok(new { internalOnly = true });

    // No [InternalScope]: only the path check protects it.
    [HttpPost("v1/internal/forgot")]
    public IActionResult Forgot() => Ok(new { forgot = true });
}
