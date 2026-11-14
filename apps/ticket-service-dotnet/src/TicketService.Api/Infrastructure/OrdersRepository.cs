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

    public sealed class OrderLockRow
    {
        [Column("status")] public string Status { get; set; } = "";
        [Column("paid_transaction_id")] public Guid? PaidTransactionId { get; set; }
    }

    public sealed class ItemRow
    {
        [Column("ticket_type_id")] public Guid TicketTypeId { get; set; }
        [Column("quantity")] public int Quantity { get; set; }
        [Column("code")] public string Code { get; set; } = "";
    }

    private const string PaidTransactionKey = "orders_paid_transaction_id_key";

    /// <summary>Order items with their ticket type code, in ascending code order (the lock order).</summary>
    private async Task<IReadOnlyList<ItemRow>> LoadSortedItemsAsync(Guid orderId, CancellationToken ct)
    {
        var items = await db.Database.SqlQuery<ItemRow>($"""
            SELECT i.ticket_type_id, i.quantity, t.code
              FROM tickets.order_items i
              JOIN tickets.ticket_types t ON t.id = i.ticket_type_id
             WHERE i.order_id = {orderId}
            """).ToListAsync(ct);
        return Pricing.SortLines(items, i => i.Code);
    }

    /// <summary>
    /// Expires one due PENDING order and releases its reservation. SKIP LOCKED lets concurrent runners
    /// (and a confirm holding the row) pass over each other. Returns the expired order id, or null when
    /// nothing is due.
    /// </summary>
    public async Task<Guid?> ExpireOneAsync(CancellationToken ct)
    {
        await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
        var due = await db.Database.SqlQuery<Guid>($"""
            SELECT id AS "Value" FROM tickets.orders
             WHERE status = 'PENDING' AND expires_at < now()
             ORDER BY expires_at
             FOR UPDATE SKIP LOCKED LIMIT 1
            """).ToListAsync(ct);
        if (due.Count == 0)
        {
            return null;
        }
        var id = due[0];
        var updated = await db.Database.ExecuteSqlAsync(
            $"UPDATE tickets.orders SET status = 'EXPIRED' WHERE id = {id} AND status = 'PENDING'", ct);
        if (updated == 0)
        {
            return null;
        }
        foreach (var item in await LoadSortedItemsAsync(id, ct))
        {
            await db.Database.ExecuteSqlAsync($"""
                UPDATE tickets.ticket_types SET reserved = reserved - {item.Quantity}
                 WHERE id = {item.TicketTypeId}
                """, ct);
        }
        await tx.CommitAsync(ct);
        return id;
    }

    /// <summary>
    /// Confirms a paid order. Lock order: the order row (blocking), then ticket types in ascending code.
    /// <see cref="Confirmation.Decide"/> picks the branch; the SQL for each branch runs here, inside the
    /// locked transaction. Any failure rolls everything back.
    /// </summary>
    public async Task<OrderView> ConfirmAsync(Guid orderId, Guid transactionId, CancellationToken ct)
    {
        try
        {
            await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.ReadCommitted, ct);
            var orders = await db.Database.SqlQuery<OrderLockRow>(
                $"SELECT status, paid_transaction_id FROM tickets.orders WHERE id = {orderId} FOR UPDATE").ToListAsync(ct);
            var order = orders.FirstOrDefault() ?? throw new OrderNotFoundException($"Order {orderId} not found");
            var decision = Confirmation.Decide(order.Status, order.PaidTransactionId, transactionId);
            if (decision == ConfirmationDecision.Replay)
            {
                return await FindAsync(orderId, ct) ?? throw new InvalidOperationException($"Order {orderId} vanished after confirmation");
            }
            if (decision == ConfirmationDecision.Reject)
            {
                throw new OrderNotConfirmableException($"Order {orderId} is already confirmed by another transaction");
            }
            // A unique violation would abort this transaction, so look first. The catch below is the
            // backstop for two orders racing on one transaction id.
            var used = await db.Database.SqlQuery<int>($"""
                SELECT 1 AS "Value" FROM tickets.orders
                 WHERE paid_transaction_id = {transactionId} AND id <> {orderId}
                """).ToListAsync(ct);
            if (used.Count > 0)
            {
                throw new OrderNotConfirmableException($"Transaction {transactionId} already confirmed another order");
            }
            foreach (var item in await LoadSortedItemsAsync(orderId, ct))
            {
                if (decision == ConfirmationDecision.ConfirmPending)
                {
                    await db.Database.ExecuteSqlAsync($"""
                        UPDATE tickets.ticket_types
                           SET reserved = reserved - {item.Quantity}, sold = sold + {item.Quantity}
                         WHERE id = {item.TicketTypeId}
                        """, ct);
                }
                else
                {
                    var rows = await db.Database.SqlQuery<Guid>($"""
                        UPDATE tickets.ticket_types SET sold = sold + {item.Quantity}
                         WHERE id = {item.TicketTypeId}
                           AND sold + reserved + {item.Quantity} <= quota
                        RETURNING id AS "Value"
                        """).ToListAsync(ct);
                    if (rows.Count == 0)
                    {
                        throw new OrderNotConfirmableException($"Order {orderId} expired and {item.Code} is no longer available");
                    }
                }
            }
            await db.Database.ExecuteSqlAsync($"""
                UPDATE tickets.orders
                   SET status = 'CONFIRMED', confirmed_at = now(), paid_transaction_id = {transactionId}
                 WHERE id = {orderId}
                """, ct);
            await tx.CommitAsync(ct);
        }
        catch (Exception ex) when (PostgresErrors.IsUniqueViolation(ex, PaidTransactionKey))
        {
            throw new OrderNotConfirmableException($"Transaction {transactionId} already confirmed another order");
        }
        return await FindAsync(orderId, ct) ?? throw new InvalidOperationException($"Order {orderId} vanished after confirmation");
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
