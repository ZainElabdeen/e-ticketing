import { randomUUID } from 'node:crypto';
import { OrderNotConfirmableError } from '../src/orders/domain/errors';
import { OrdersService } from '../src/orders/orders.service';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { startTicketService, type RunningService } from './support/app';

let db: TestDatabase;
let service: RunningService;
let orders: OrdersService;

async function sql(text: string, params: unknown[] = []): Promise<Record<string, unknown>[]> {
  const client = await db.connectAs('postgres');
  try {
    return (await client.query(text, params)).rows as Record<string, unknown>[];
  } finally {
    await client.end();
  }
}

async function counters(code: string): Promise<{ sold: number; reserved: number }> {
  const rows = await sql(`SELECT sold, reserved FROM tickets.ticket_types WHERE code = $1`, [code]);
  return rows[0] as { sold: number; reserved: number };
}

/** Does what the expiry job does to an order: EXPIRED and its reservation released. */
async function expire(orderId: string): Promise<void> {
  await sql(`UPDATE tickets.orders SET status = 'EXPIRED' WHERE id = $1`, [orderId]);
  await sql(
    `UPDATE tickets.ticket_types t SET reserved = t.reserved - i.quantity
       FROM tickets.order_items i WHERE i.order_id = $1 AND i.ticket_type_id = t.id`,
    [orderId],
  );
}

beforeEach(async () => {
  db = await startTestDatabase();
  applyMigrations(db, 'ticket-service');
  service = await startTicketService(db);
  orders = service.app.get(OrdersService);
});

afterEach(async () => {
  await service?.close();
  await db?.stop();
});

describe('confirm', () => {
  it('honors an expired order when quota allows', async () => {
    const order = await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 2 }]);
    await expire(order.id);
    const before = await counters('GOLD');
    const confirmed = await orders.confirmOrder(order.id, randomUUID());
    expect(confirmed.status).toBe('CONFIRMED');
    const after = await counters('GOLD');
    expect(after.sold - before.sold).toBe(2);
    expect(after.reserved).toBe(before.reserved);
  });

  it('refuses an expired order when quota is gone, all or nothing', async () => {
    const order = await orders.createOrder([
      { ticketTypeCode: 'GOLD', quantity: 1 },
      { ticketTypeCode: 'VIP', quantity: 1 },
    ]);
    await expire(order.id);
    await sql(`UPDATE tickets.ticket_types SET sold = quota WHERE code = 'VIP'`);
    const goldBefore = await counters('GOLD');
    await expect(orders.confirmOrder(order.id, randomUUID())).rejects.toBeInstanceOf(
      OrderNotConfirmableError,
    );
    const rows = await sql(`SELECT status FROM tickets.orders WHERE id = $1`, [order.id]);
    expect(rows[0]).toEqual({ status: 'EXPIRED' });
    expect(await counters('GOLD')).toEqual(goldBefore);
  });

  it('counts a transaction once under concurrent confirms', async () => {
    const order = await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 2 }]);
    const before = await counters('GOLD');
    const txn = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => orders.confirmOrder(order.id, txn)),
    );
    for (const r of results) expect(r.status).toBe('CONFIRMED');
    const after = await counters('GOLD');
    expect(after.sold - before.sold).toBe(2);
    expect(after.reserved - before.reserved).toBe(-2);
  }, 60_000);

  it('rejects a transaction id already used by another order', async () => {
    const a = await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 1 }]);
    const b = await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 1 }]);
    const txn = randomUUID();
    await orders.confirmOrder(a.id, txn);
    const before = await counters('GOLD');
    await expect(orders.confirmOrder(b.id, txn)).rejects.toBeInstanceOf(OrderNotConfirmableError);
    expect(await counters('GOLD')).toEqual(before);
  });

  it('lets exactly one of several orders racing on one transaction id win', async () => {
    const created = await Promise.all(
      Array.from({ length: 4 }, () =>
        orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 1 }]),
      ),
    );
    const before = await counters('GOLD');
    const txn = randomUUID();
    const results = await Promise.allSettled(created.map((o) => orders.confirmOrder(o.id, txn)));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    for (const r of results) {
      if (r.status === 'rejected') expect(r.reason).toBeInstanceOf(OrderNotConfirmableError);
    }
    const after = await counters('GOLD');
    expect(after.sold - before.sold).toBe(1);
    expect(after.reserved - before.reserved).toBe(-1);
  }, 60_000);
});
