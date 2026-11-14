using TicketService.Api.Config;
using TicketService.Api.Contracts;
using TicketService.Api.Domain;
using TicketService.Api.Infrastructure;

namespace TicketService.Api.Application;

public sealed class OrdersService(OrdersRepository repository, TicketServiceOptions options)
{
    public Task<OrderView> CreateOrderAsync(CreateOrderRequest request, CancellationToken ct) =>
        repository.ReserveAndCreateAsync(
            request.Items!.Select(i => (i!.TicketTypeCode!, i.Quantity!.Value)).ToList(),
            options.OrderTtlMinutes,
            ct);

    public Task<OrderView> ConfirmOrderAsync(Guid orderId, Guid transactionId, CancellationToken ct) =>
        repository.ConfirmAsync(orderId, transactionId, ct);

    public async Task<OrderView> GetOrderAsync(Guid id, CancellationToken ct) =>
        await repository.FindAsync(id, ct) ?? throw new OrderNotFoundException($"Order {id} not found");
}
