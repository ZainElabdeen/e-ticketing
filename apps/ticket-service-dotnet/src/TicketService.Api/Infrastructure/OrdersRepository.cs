using System.ComponentModel.DataAnnotations.Schema;
using System.Data;
using System.Globalization;
using Microsoft.EntityFrameworkCore;
using TicketService.Api.Contracts;
using TicketService.Api.Domain;

namespace TicketService.Api.Infrastructure;

public sealed class OrdersRepository(TicketsDbContext db)
{
    private const string TimestampFormat = "yyyy-MM-dd'T'HH:mm:ss.fff'Z'";

    public sealed class ReservedRow
    {
        [Column("id")] public Guid Id { get; set; }
        [Column("price_minor")] public long PriceMinor { get; set; }
        [Column("currency")] public string Currency { get; set; } = "";
    }

    /// <summary>
    /// Reserves quota for every line and creates the order in one transaction. Ticket types are
    /// locked in ascending code order (the UPDATE takes the row lock), so concurrent orders cannot
    /// deadlock. Any failed line rolls back all.
    /// </summary>
    public async Task<OrderView> ReserveAndCreateAsync(
        IReadOnlyList<(string Code, int Qty)> lines, int ttlMinutes, CancellationToken ct)
    {
        Guid orderId;
        await using (var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct))
        {
            var priced = new List<PricedLine>();
            foreach (var (code, qty) in Pricing.SortLines(lines, l => l.Code))
            {
                var rows = await db.Database
                    .SqlQuery<ReservedRow>($"""
                        UPDATE tickets.ticket_types SET reserved = reserved + {qty}
                         WHERE code = {code} AND sold + reserved + {qty} <= quota
                        RETURNING id, price_minor, currency
                        """)
                    .ToListAsync(ct);
                var reserved = rows.FirstOrDefault() ?? throw new QuotaExceededException(code);
                priced.Add(new PricedLine(code, reserved.Id, qty, reserved.PriceMinor, reserved.PriceMinor * qty, reserved.Currency));
            }
            var (totalMinor, currency) = Pricing.Price(priced);
            var inserted = await db.Database
                .SqlQuery<Guid>($"""
                    INSERT INTO tickets.orders (status, total_minor, currency, expires_at)
                    VALUES ('PENDING', {totalMinor}, {currency}, now() + make_interval(mins => {ttlMinutes}))
                    RETURNING id AS "Value"
                    """)
                .ToListAsync(ct);
            orderId = inserted.Count > 0 ? inserted[0] : throw new InvalidOperationException("Order insert returned no id");
            foreach (var line in priced)
            {
                await db.Database.ExecuteSqlAsync($"""
                    INSERT INTO tickets.order_items (order_id, ticket_type_id, quantity, unit_price_minor, line_total_minor)
                    VALUES ({orderId}, {line.TicketTypeId}, {line.Quantity}, {line.UnitPriceMinor}, {line.LineTotalMinor})
                    """, ct);
            }
            await tx.CommitAsync(ct);
        }
        return await FindAsync(orderId, ct) ?? throw new InvalidOperationException($"Order {orderId} vanished after creation");
    }

    public async Task<OrderView?> FindAsync(Guid id, CancellationToken ct)
    {
        var order = await db.Orders.SingleOrDefaultAsync(o => o.Id == id, ct);
        if (order is null)
        {
            return null;
        }
        var items = await (from i in db.OrderItems
                           join t in db.TicketTypes on i.TicketTypeId equals t.Id
                           where i.OrderId == id
                           select new { t.Code, i.Quantity, i.UnitPriceMinor, i.LineTotalMinor }).ToListAsync(ct);
        return new OrderView(
            order.Id,
            order.Status,
            items.OrderBy(i => i.Code, StringComparer.Ordinal)
                .Select(i => new OrderItemView(i.Code, i.Quantity, i.UnitPriceMinor, i.LineTotalMinor))
                .ToList(),
            order.TotalMinor,
            order.Currency,
            Format(order.CreatedAt),
            Format(order.ExpiresAt),
            order.ConfirmedAt is { } confirmed ? Format(confirmed) : null,
            order.PaidTransactionId);
    }

    private static string Format(DateTime value) => value.ToUniversalTime().ToString(TimestampFormat, CultureInfo.InvariantCulture);
}
