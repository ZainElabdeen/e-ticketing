using FluentValidation;
using TicketService.Api.Domain;

namespace TicketService.Api.Contracts;

public sealed class CreateOrderItemValidator : AbstractValidator<CreateOrderItem>
{
    public CreateOrderItemValidator()
    {
        RuleFor(x => x.TicketTypeCode)
            .Must(TicketTypeCode.IsValid)
            .WithMessage("ticketTypeCode must be one of the following values: GOLD, PREMIUM, VIP");
        RuleFor(x => x.Quantity)
            .NotNull().WithMessage("quantity must be an integer number")
            .InclusiveBetween(1, 10).WithMessage("quantity must be between 1 and 10");
    }
}

public sealed class CreateOrderRequestValidator : AbstractValidator<CreateOrderRequest>
{
    public CreateOrderRequestValidator()
    {
        RuleFor(x => x.Items).NotNull().WithMessage("items must be an array");
        RuleFor(x => x.Items)
            .Must(items => items!.Count is >= 1 and <= 3).WithMessage("items must contain between 1 and 3 elements")
            .When(x => x.Items is not null);
        RuleFor(x => x.Items)
            .Must(items => items!.Where(i => i is not null).Select(i => i!.TicketTypeCode).Distinct().Count()
                == items!.Count(i => i is not null))
            .WithMessage("each ticketTypeCode may appear at most once")
            .When(x => x.Items is not null);
        RuleForEach(x => x.Items)
            .NotNull().WithMessage("each item must be an object")
            .SetValidator(new CreateOrderItemValidator()!);
    }
}
