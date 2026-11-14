using FluentValidation;

namespace TicketService.Api.Contracts;

// Nullable so a missing or null member binds and the validator rejects it with a 400.
public sealed class ConfirmOrderRequest
{
    public Guid? TransactionId { get; init; }
}

public sealed class ConfirmOrderRequestValidator : AbstractValidator<ConfirmOrderRequest>
{
    public ConfirmOrderRequestValidator()
    {
        RuleFor(x => x.TransactionId).NotNull().WithMessage("transactionId must be a UUID");
    }
}
