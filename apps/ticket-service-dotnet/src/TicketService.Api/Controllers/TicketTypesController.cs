using Microsoft.AspNetCore.Mvc;
using TicketService.Api.Application;
using TicketService.Api.Contracts;

namespace TicketService.Api.Controllers;

[ApiController]
[Route("v1/ticket-types")]
public sealed class TicketTypesController(TicketTypesService service) : ControllerBase
{
    [HttpGet]
    public Task<TicketTypeList> List(CancellationToken ct) => service.ListAsync(ct);
}
