namespace TicketService.Api.Domain;

public static class TicketTypeCode
{
    public const string Gold = "GOLD";
    public const string Premium = "PREMIUM";
    public const string Vip = "VIP";

    public static readonly IReadOnlyList<string> All = [Gold, Premium, Vip];

    public static bool IsValid(string? code) => code is not null && All.Contains(code, StringComparer.Ordinal);
}
