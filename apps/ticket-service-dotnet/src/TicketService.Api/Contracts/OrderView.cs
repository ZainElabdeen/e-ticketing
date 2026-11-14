namespace TicketService.Api.Contracts;

public sealed record OrderItemView(string TicketTypeCode, int Quantity, long UnitPriceMinor, long LineTotalMinor);

/// <summary>Timestamps are preformatted (yyyy-MM-ddTHH:mm:ss.fffZ, like JS toISOString).</summary>
public sealed record OrderView(
    Guid Id,
    string Status,
    IReadOnlyList<OrderItemView> Items,
    long TotalMinor,
    string Currency,
    string CreatedAt,
    string ExpiresAt,
    string? ConfirmedAt,
    Guid? PaidTransactionId);
