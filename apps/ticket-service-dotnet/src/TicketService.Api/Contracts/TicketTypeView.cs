namespace TicketService.Api.Contracts;

public sealed record TicketTypeView(
    string Code, string Name, long PriceMinor, string Currency, int Quota, int Sold, int Reserved, int Available);

public sealed record TicketTypeList(IReadOnlyList<TicketTypeView> Data);
