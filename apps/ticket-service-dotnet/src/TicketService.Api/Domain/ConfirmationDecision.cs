namespace TicketService.Api.Domain;

public enum ConfirmationDecision { Replay, ConfirmPending, ConfirmExpired, Reject }

public static class Confirmation
{
    /// <summary>
    /// What to do with a payment confirmation. A paid order is honoured even after it expired (the
    /// money is already taken); the repository then re-checks quota because expiry released the reservation.
    /// </summary>
    public static ConfirmationDecision Decide(string status, Guid? paidTransactionId, Guid transactionId) => status switch
    {
        OrderStatus.Pending => ConfirmationDecision.ConfirmPending,
        OrderStatus.Expired => ConfirmationDecision.ConfirmExpired,
        OrderStatus.Confirmed => paidTransactionId == transactionId ? ConfirmationDecision.Replay : ConfirmationDecision.Reject,
        _ => throw new InvalidOperationException($"Unknown order status '{status}'"),
    };
}
