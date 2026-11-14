using Microsoft.AspNetCore.Mvc;
using TicketService.Api.Application;
using TicketService.Api.Contracts;
using TicketService.Api.Http;

namespace TicketService.Api.Controllers;

[ApiController]
[Route("v1/orders")]
public sealed class OrdersController(OrdersService service) : ControllerBase
{
    [HttpPost]
    public async Task<IActionResult> Create([FromBody] CreateOrderRequest? request, CancellationToken ct)
    {
        return StatusCode(StatusCodes.Status201Created, await service.CreateOrderAsync(request!, ct));
    }

    // A string, not {orderId:guid}: a route constraint would answer 404 where the NestJS service answers 400.
    [HttpGet("{orderId}")]
    public async Task<OrderView> Get(string orderId, CancellationToken ct)
    {
        if (!Guid.TryParseExact(orderId, "D", out var id))
        {
            throw new RequestValidationException("Validation failed (uuid is expected)");
        }
        return await service.GetOrderAsync(id, ct);
    }
}
