using Microsoft.EntityFrameworkCore;
using TicketService.Api.Contracts;

namespace TicketService.Api.Infrastructure;

public sealed class TicketTypesRepository(TicketsDbContext db)
{
    public async Task<IReadOnlyList<TicketTypeView>> ListAsync(CancellationToken ct)
    {
        var rows = await db.TicketTypes.ToListAsync(ct);
        // Ordinal in memory so the order does not depend on the database collation.
        return rows.OrderBy(t => t.Code, StringComparer.Ordinal).Select(Map).ToList();
    }

    private static TicketTypeView Map(TicketTypeEntity t) =>
        new(t.Code, t.Name, t.PriceMinor, t.Currency, t.Quota, t.Sold, t.Reserved, t.Quota - t.Sold - t.Reserved);
}
