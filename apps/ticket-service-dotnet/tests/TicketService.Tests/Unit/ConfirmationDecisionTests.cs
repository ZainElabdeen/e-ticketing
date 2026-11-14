using TicketService.Api.Domain;

namespace TicketService.Tests.Unit;

[Trait("Category", "Unit")]
public sealed class ConfirmationDecisionTests
{
    private static readonly Guid T = Guid.NewGuid();
    private static readonly Guid U = Guid.NewGuid();

    [Fact]
    public void A_pending_order_is_confirmed() =>
        Assert.Equal(ConfirmationDecision.ConfirmPending, Confirmation.Decide("PENDING", null, T));

    [Fact]
    public void An_expired_order_is_honoured_but_rechecked() =>
        Assert.Equal(ConfirmationDecision.ConfirmExpired, Confirmation.Decide("EXPIRED", null, T));

    [Fact]
    public void A_confirmed_order_with_the_same_transaction_is_a_replay() =>
        Assert.Equal(ConfirmationDecision.Replay, Confirmation.Decide("CONFIRMED", T, T));

    [Fact]
    public void A_confirmed_order_with_another_transaction_is_rejected() =>
        Assert.Equal(ConfirmationDecision.Reject, Confirmation.Decide("CONFIRMED", U, T));

    [Fact]
    public void An_unknown_status_is_a_programming_error() =>
        Assert.Throws<InvalidOperationException>(() => Confirmation.Decide("BOGUS", null, T));
}
