using TicketService.Api.Domain;

namespace TicketService.Api.Http;

/// <summary>A request failed validation: the envelope answers 400 VALIDATION_ERROR.</summary>
public sealed class RequestValidationException(string message) : DomainException(message)
{
    public override string Code => "VALIDATION_ERROR";
    public override int StatusCode => 400;
}
