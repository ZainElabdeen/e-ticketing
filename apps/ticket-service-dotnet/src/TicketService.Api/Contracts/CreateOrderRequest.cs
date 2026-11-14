namespace TicketService.Api.Contracts;

// Everything is nullable so a missing or null member binds and the validator rejects it with a 400.
public sealed class CreateOrderRequest
{
    public List<CreateOrderItem?>? Items { get; init; }
}

public sealed class CreateOrderItem
{
    public string? TicketTypeCode { get; init; }
    public int? Quantity { get; init; }
}
