namespace TicketService.Api.Infrastructure;

public sealed class TicketTypeEntity
{
    public Guid Id { get; set; }
    public string Code { get; set; } = "";
    public string Name { get; set; } = "";
    public long PriceMinor { get; set; }
    public string Currency { get; set; } = "";
    public int Quota { get; set; }
    public int Sold { get; set; }
    public int Reserved { get; set; }
}

public sealed class OrderEntity
{
    public Guid Id { get; set; }
    public string Status { get; set; } = "";
    public long TotalMinor { get; set; }
    public string Currency { get; set; } = "";
    public DateTime CreatedAt { get; set; }
    public DateTime ExpiresAt { get; set; }
    public DateTime? ConfirmedAt { get; set; }
    public Guid? PaidTransactionId { get; set; }
    public List<OrderItemEntity> Items { get; set; } = [];
}

public sealed class OrderItemEntity
{
    public Guid Id { get; set; }
    public Guid OrderId { get; set; }
    public Guid TicketTypeId { get; set; }
    public int Quantity { get; set; }
    public long UnitPriceMinor { get; set; }
    public long LineTotalMinor { get; set; }
}
