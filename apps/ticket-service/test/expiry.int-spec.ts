import { randomUUID } from 'node:crypto';
import { SchedulerRegistry } from '@nestjs/schedule';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { OrderExpiryJob } from '../src/orders/order-expiry.job';
import { OrdersService } from '../src/orders/orders.service';
import { startTicketService, type RunningService } from './support/app';

let db: TestDatabase;
let service: RunningService | undefined;

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

async function statusOf(id: string): Promise<string> {
  const rows = await sql(`SELECT status FROM tickets.orders WHERE id = $1`, [id]);
  return rows[0]?.status as string;
}

async function makeDue(id?: string): Promise<void> {
  if (id) {
    await sql(`UPDATE tickets.orders SET expires_at = now() - interval '1 minute' WHERE id = $1`, [
      id,
    ]);
  } else {
    await sql(`UPDATE tickets.orders SET expires_at = now() - interval '1 minute'`);
  }
}

beforeEach(async () => {
  db = await startTestDatabase();
  applyMigrations(db, 'ticket-service');
});

afterEach(async () => {
  await service?.close();
  service = undefined;
  await db?.stop();
});

describe('order expiry job', () => {
  it('releases expired reservations exactly once', async () => {
    service = await startTicketService(db);
    const orders = service.app.get(OrdersService);
    const job = service.app.get(OrderExpiryJob);
    const order = await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 3 }]);
    expect((await counters('GOLD')).reserved).toBe(3);
    await makeDue();
    expect(await job.runOnce()).toBe(1);
    expect(await statusOf(order.id)).toBe('EXPIRED');
    expect((await counters('GOLD')).reserved).toBe(0);
    expect(await job.runOnce()).toBe(0);
    expect((await counters('GOLD')).reserved).toBe(0);
  });

  it('leaves unexpired and confirmed orders alone', async () => {
    service = await startTicketService(db);
    const orders = service.app.get(OrdersService);
    const job = service.app.get(OrderExpiryJob);
    const fresh = await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 1 }]);
    const paid = await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 2 }]);
    await orders.confirmOrder(paid.id, randomUUID());
    await makeDue(paid.id);
    const before = await counters('GOLD');
    expect(await job.runOnce()).toBe(0);
    expect(await statusOf(fresh.id)).toBe('PENDING');
    expect(await statusOf(paid.id)).toBe('CONFIRMED');
    expect(await counters('GOLD')).toEqual(before);
  });

  it('expires at most ORDER_EXPIRY_BATCH_SIZE orders per run', async () => {
    service = await startTicketService(db, { ORDER_EXPIRY_BATCH_SIZE: '2' });
    const orders = service.app.get(OrdersService);
    const job = service.app.get(OrderExpiryJob);
    for (let i = 0; i < 3; i++) {
      await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 1 }]);
    }
    await makeDue();
    expect(await job.runOnce()).toBe(2);
    expect(await job.runOnce()).toBe(1);
    expect((await counters('GOLD')).reserved).toBe(0);
  });

  it('survives confirm racing expiry: every order confirmed, counters exact', async () => {
    service = await startTicketService(db);
    const orders = service.app.get(OrdersService);
    const job = service.app.get(OrderExpiryJob);
    await sql(
      `UPDATE tickets.ticket_types SET quota = 100, sold = 0, reserved = 0 WHERE code = 'GOLD'`,
    );
    const created = [];
    for (let i = 0; i < 20; i++) {
      created.push(await orders.createOrder([{ ticketTypeCode: 'GOLD', quantity: 1 }]));
    }
    await makeDue();
    const calls: Promise<unknown>[] = [];
    created.forEach((o, i) => {
      if (i % 5 === 0) calls.push(job.runOnce());
      calls.push(orders.confirmOrder(o.id, randomUUID()));
    });
    calls.push(job.runOnce());
    const results = await Promise.allSettled(calls);
    for (const r of results) {
      expect(r.status).toBe('fulfilled');
    }
    for (const o of created) expect(await statusOf(o.id)).toBe('CONFIRMED');
    expect(await counters('GOLD')).toEqual({ sold: 20, reserved: 0 });
  }, 60_000);

  it('registers the interval when enabled and removes it on close', async () => {
    service = await startTicketService(db, {
      ORDER_EXPIRY_ENABLED: 'true',
      ORDER_EXPIRY_INTERVAL_SECONDS: '3600',
    });
    const registry = service.app.get(SchedulerRegistry);
    expect(registry.getIntervals()).toContain('order-expiry');
    await service.close();
    service = undefined;
    expect(registry.getIntervals()).not.toContain('order-expiry');
  });

  it('does not register the interval when disabled', async () => {
    service = await startTicketService(db);
    expect(service.app.get(SchedulerRegistry).getIntervals()).not.toContain('order-expiry');
  });
});
