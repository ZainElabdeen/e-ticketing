import { QuotaExceededError } from '../src/orders/domain/errors';
import { OrdersService } from '../src/orders/orders.service';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { startTicketService, type RunningService } from './support/app';

let db: TestDatabase;
let service: RunningService;
let orders: OrdersService;

async function sql(text: string): Promise<Record<string, unknown>[]> {
  const client = await db.connectAs('postgres');
  try {
    return (await client.query(text)).rows as Record<string, unknown>[];
  } finally {
    await client.end();
  }
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

describe('reservation', () => {
  it('never oversells across types under concurrency', async () => {
    await sql(
      `UPDATE tickets.ticket_types SET quota = 5, sold = 0, reserved = 0 WHERE code IN ('GOLD','VIP')`,
    );
    const forward = Array.from({ length: 12 }, () =>
      orders.createOrder([
        { ticketTypeCode: 'GOLD', quantity: 1 },
        { ticketTypeCode: 'VIP', quantity: 1 },
      ]),
    );
    const reversed = Array.from({ length: 12 }, () =>
      orders.createOrder([
        { ticketTypeCode: 'VIP', quantity: 1 },
        { ticketTypeCode: 'GOLD', quantity: 1 },
      ]),
    );
    const results = await Promise.allSettled([...forward, ...reversed]);
    const rejected = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(5);
    expect(rejected).toHaveLength(19);
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(QuotaExceededError);
    }
    const rows = await sql(
      `SELECT code, reserved FROM tickets.ticket_types WHERE code IN ('GOLD','VIP') ORDER BY code`,
    );
    expect(rows).toEqual([
      { code: 'GOLD', reserved: 5 },
      { code: 'VIP', reserved: 5 },
    ]);
  }, 60_000);

  it('computes the total on the server from the stored price', async () => {
    await sql(`UPDATE tickets.ticket_types SET price_minor = 12345 WHERE code = 'GOLD'`);
    const order = await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 3 }]);
    expect(order.totalMinor).toBe(37035);
    const rows = await sql(
      `SELECT unit_price_minor::text AS u FROM tickets.order_items WHERE order_id = '${order.id}'`,
    );
    expect(rows).toEqual([{ u: '12345' }]);
  });
});
