using TicketService.Api.Contracts;
using TicketService.Api.Infrastructure;

namespace TicketService.Api.Application;

public sealed class TicketTypesService(TicketTypesRepository repository)
{
    public async Task<TicketTypeList> ListAsync(CancellationToken ct) => new(await repository.ListAsync(ct));
}
