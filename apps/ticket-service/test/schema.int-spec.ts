import { randomUUID } from 'node:crypto';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

interface OrderExtra {
  totalMinor?: number;
  confirmedAt?: string | null;
  paidTransactionId?: string | null;
}

const RESERVE_SQL = `
  UPDATE tickets.ticket_types
     SET reserved = reserved + $1
   WHERE code = $2 AND sold + reserved + $1 <= quota
  RETURNING id
`;

describe('tickets schema', () => {
  let db: TestDatabase;
  let app: Client;

  const insertOrder = async (status: string, extra: OrderExtra = {}): Promise<string> => {
    const id = randomUUID();
    await app.query(
      `INSERT INTO tickets.orders
         (id, status, total_minor, expires_at, confirmed_at, paid_transaction_id)
       VALUES ($1, $2, $3, now() + interval '15 minutes', $4, $5)`,
      [
        id,
        status,
        extra.totalMinor ?? 10000,
        extra.confirmedAt ?? null,
        extra.paidTransactionId ?? null,
      ],
    );
    return id;
  };

  const insertItem = (orderId: string, quantity: number, unitMinor: number, lineMinor: number) =>
    app.query(
      `INSERT INTO tickets.order_items
         (order_id, ticket_type_id, quantity, unit_price_minor, line_total_minor)
       SELECT $1, id, $2, $3, $4 FROM tickets.ticket_types WHERE code = 'GOLD'`,
      [orderId, quantity, unitMinor, lineMinor],
    );

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'ticket-service');
    app = await db.connectAs('tickets_app');
  });

  afterAll(async () => {
    await app.end();
    await db.stop();
  });

  it('seeds the three ticket types', async () => {
    const { rows } = await app.query(
      `SELECT code, name, price_minor, currency, quota, sold, reserved
         FROM tickets.ticket_types
        ORDER BY price_minor`,
    );

    expect(rows).toEqual([
      {
        code: 'GOLD',
        name: 'Gold',
        price_minor: '10000',
        currency: 'AED',
        quota: 100,
        sold: 0,
        reserved: 0,
      },
      {
        code: 'PREMIUM',
        name: 'Premium',
        price_minor: '20000',
        currency: 'AED',
        quota: 100,
        sold: 0,
        reserved: 0,
      },
      {
        code: 'VIP',
        name: 'VIP',
        price_minor: '50000',
        currency: 'AED',
        quota: 100,
        sold: 0,
        reserved: 0,
      },
    ]);
  });

  it('rejects sold + reserved above quota', async () => {
    await expect(
      app.query(`UPDATE tickets.ticket_types SET reserved = 101 WHERE code = 'GOLD'`),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('conditional reservation UPDATE stops at the quota edge', async () => {
    await app.query('BEGIN');
    try {
      await app.query(`UPDATE tickets.ticket_types SET sold = 95 WHERE code = 'GOLD'`);

      const over = await app.query(RESERVE_SQL, [6, 'GOLD']);
      expect(over.rowCount).toBe(0);

      const fits = await app.query(RESERVE_SQL, [5, 'GOLD']);
      expect(fits.rowCount).toBe(1);
    } finally {
      await app.query('ROLLBACK');
    }
  });

  it('never oversells under 20 concurrent reservations of 10', async () => {
    await app.query(`UPDATE tickets.ticket_types SET sold = 0, reserved = 0 WHERE code = 'GOLD'`);

    const clients = await Promise.all(
      Array.from({ length: 20 }, () => db.connectAs('tickets_app')),
    );
    let results: { rowCount: number | null }[];
    try {
      results = await Promise.all(clients.map((client) => client.query(RESERVE_SQL, [10, 'GOLD'])));
    } finally {
      await Promise.all(clients.map((client) => client.end()));
    }

    expect(results.filter((result) => result.rowCount === 1)).toHaveLength(10);
    const { rows } = await app.query(
      `SELECT sold, reserved FROM tickets.ticket_types WHERE code = 'GOLD'`,
    );
    expect(rows).toEqual([{ sold: 0, reserved: 100 }]);

    await app.query(`UPDATE tickets.ticket_types SET reserved = 0 WHERE code = 'GOLD'`);
  });

  it('ties CONFIRMED to confirmed_at and paid_transaction_id', async () => {
    await expect(insertOrder('CONFIRMED')).rejects.toMatchObject({ code: '23514' });

    await expect(
      insertOrder('PENDING', {
        confirmedAt: new Date().toISOString(),
        paidTransactionId: randomUUID(),
      }),
    ).rejects.toMatchObject({ code: '23514' });

    await expect(
      insertOrder('CONFIRMED', {
        confirmedAt: new Date().toISOString(),
        paidTransactionId: randomUUID(),
      }),
    ).resolves.toBeTruthy();
  });

  it('rejects order statuses outside PENDING/CONFIRMED/EXPIRED', async () => {
    await expect(insertOrder('CANCELLED')).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps paid_transaction_id unique', async () => {
    const transactionId = randomUUID();
    const extra = { confirmedAt: new Date().toISOString(), paidTransactionId: transactionId };

    await insertOrder('CONFIRMED', extra);
    await expect(insertOrder('CONFIRMED', extra)).rejects.toMatchObject({ code: '23505' });
  });

  it('validates order items', async () => {
    const orderId = await insertOrder('PENDING');

    await expect(insertItem(orderId, 11, 10000, 110000)).rejects.toMatchObject({ code: '23514' });
    await expect(insertItem(orderId, 2, 10000, 99999)).rejects.toMatchObject({ code: '23514' });

    await insertItem(orderId, 2, 10000, 20000);
    await expect(insertItem(orderId, 1, 10000, 10000)).rejects.toMatchObject({ code: '23505' });
  });

  it('blocks deleting a ticket type that has order items', async () => {
    const orderId = await insertOrder('PENDING');
    await insertItem(orderId, 1, 10000, 10000);

    const owner = await db.connectAs('tickets_owner');
    try {
      await expect(
        owner.query(`DELETE FROM tickets.ticket_types WHERE code = 'GOLD'`),
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await owner.end();
    }
  });

  it('denies tickets_app access to the payments schema', async () => {
    await expect(app.query('SELECT 1 FROM payments.payments')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
