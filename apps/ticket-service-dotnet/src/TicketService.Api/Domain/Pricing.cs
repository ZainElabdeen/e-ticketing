namespace TicketService.Api.Domain;

public sealed record PricedLine(
    string TicketTypeCode, Guid TicketTypeId, int Quantity, long UnitPriceMinor, long LineTotalMinor, string Currency);

public static class Pricing
{
    /// <summary>Ascending by code. Every writer locks ticket types in this order, so two orders cannot deadlock.</summary>
    public static IReadOnlyList<T> SortLines<T>(IEnumerable<T> lines, Func<T, string> code) =>
        lines.OrderBy(code, StringComparer.Ordinal).ToList();

    public static (long TotalMinor, string Currency) Price(IReadOnlyList<PricedLine> lines)
    {
        var currency = lines.Count > 0 ? lines[0].Currency : throw new InvalidOperationException("Order has no lines");
        long total = 0;
        foreach (var line in lines)
        {
            if (line.Currency != currency)
            {
                throw new InvalidOperationException("Order lines mix currencies");
            }
            if (line.LineTotalMinor != checked(line.UnitPriceMinor * line.Quantity))
            {
                throw new InvalidOperationException($"Line total mismatch for {line.TicketTypeCode}");
            }
            total = checked(total + line.LineTotalMinor);
        }
        return (total, currency);
    }
}
