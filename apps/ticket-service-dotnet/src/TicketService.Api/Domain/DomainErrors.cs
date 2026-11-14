namespace TicketService.Api.Domain;

public abstract class DomainException(string message) : Exception(message)
{
    public abstract string Code { get; }
    public abstract int StatusCode { get; }
}

public sealed class OrderNotFoundException(string message = "Order not found") : DomainException(message)
{
    public override string Code => "NOT_FOUND";
    public override int StatusCode => 404;
}

public sealed class QuotaExceededException(string ticketTypeCode)
    : DomainException($"Not enough {ticketTypeCode} tickets left")
{
    public override string Code => "QUOTA_EXCEEDED";
    public override int StatusCode => 409;
}

public sealed class OrderNotConfirmableException(string message = "Order cannot be confirmed") : DomainException(message)
{
    public override string Code => "ORDER_NOT_CONFIRMABLE";
    public override int StatusCode => 409;
}
