using Microsoft.AspNetCore.Mvc;
using TicketService.Api.Application;
using TicketService.Api.Contracts;
using TicketService.Api.Http;

namespace TicketService.Api.Controllers;

[ApiController]
[InternalScope]
[Route("v1/internal/orders")]
public sealed class InternalOrdersController(OrdersService service) : ControllerBase
{
    // A string, not {orderId:guid}: a route constraint would answer 404 where the NestJS service answers 400.
    [HttpPost("{orderId}/confirm")]
    public async Task<OrderView> Confirm(string orderId, [FromBody] ConfirmOrderRequest? request, CancellationToken ct)
    {
        if (!Guid.TryParseExact(orderId, "D", out var id))
        {
            throw new RequestValidationException("Validation failed (uuid is expected)");
        }
        return await service.ConfirmOrderAsync(id, request!.TransactionId!.Value, ct);
    }
}
