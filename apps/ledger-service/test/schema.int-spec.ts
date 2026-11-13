import { randomUUID } from 'node:crypto';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

type Direction = 'DEBIT' | 'CREDIT';
type Line = [accountCode: string, direction: Direction, amountMinor: number];

interface EntryOptions {
  transactionId?: string;
  postingType?: string;
  currency?: string;
}

/**
 * Posts one journal entry in a single DB transaction: entry row, then its
 * lines, then COMMIT — which is when the deferred balance triggers run.
 */
async function postEntry(
  client: Client,
  lines: Line[],
  options: EntryOptions = {},
): Promise<string> {
  const transactionId = options.transactionId ?? randomUUID();

  await client.query('BEGIN');
  try {
    await client.query(
      `INSERT INTO ledger.journal_entries
         (transaction_id, posting_type, payment_reference, order_id, description, currency)
       VALUES ($1, $2, 'PAY-20261113-7F3K9Q', $3, 'test', $4)`,
      [
        transactionId,
        options.postingType ?? 'TICKET_SALE',
        randomUUID(),
        options.currency ?? 'AED',
      ],
    );

    for (const [code, direction, amountMinor] of lines) {
      await client.query(
        `INSERT INTO ledger.journal_lines (journal_entry_id, account_id, direction, amount_minor)
         SELECT e.id, a.id, $2, $3
           FROM ledger.journal_entries e, ledger.accounts a
          WHERE e.transaction_id = $1 AND a.code = $4`,
        [transactionId, direction, amountMinor, code],
      );
    }

    await client.query('COMMIT');
    return transactionId;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
}

describe('ledger schema', () => {
  let db: TestDatabase;
  let app: Client;

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'ledger-service');
    app = await db.connectAs('ledger_app');
  });

  afterAll(async () => {
    await app.end();
    await db.stop();
  });

  it('seeds the chart of accounts', async () => {
    const { rows } = await app.query<{
      code: string;
      name: string;
      type: string;
      currency: string;
    }>('SELECT code, name, type, currency FROM ledger.accounts ORDER BY code');

    expect(rows.map((row) => [row.code, row.name, row.type, row.currency])).toEqual([
      ['1100', 'Payment Gateway Clearing', 'ASSET', 'AED'],
      ['2100', 'Customer Refunds Payable', 'LIABILITY', 'AED'],
      ['4000', 'Ticket Sales Revenue', 'REVENUE', 'AED'],
    ]);
  });

  it('commits a balanced entry', async () => {
    await expect(
      postEntry(app, [
        ['1100', 'DEBIT', 70000],
        ['4000', 'CREDIT', 70000],
      ]),
    ).resolves.toBeTruthy();
  });

  it('rejects an unbalanced entry at commit', async () => {
    await expect(
      postEntry(app, [
        ['1100', 'DEBIT', 70000],
        ['4000', 'CREDIT', 60000],
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringMatching(/unbalanced/) as string,
    });
  });

  it('rejects an entry with one line', async () => {
    await expect(postEntry(app, [['1100', 'DEBIT', 70000]])).rejects.toMatchObject({
      code: '23514',
      message: expect.stringMatching(/fewer than 2 lines/) as string,
    });
  });

  it('rejects an entry with no lines', async () => {
    await expect(postEntry(app, [])).rejects.toMatchObject({
      code: '23514',
      message: expect.stringMatching(/fewer than 2 lines/) as string,
    });
  });

  it('rejects a line in another currency', async () => {
    const owner = await db.connectAs('ledger_owner');
    try {
      await owner.query(`INSERT INTO ledger.accounts (code, name, type, currency)
                         VALUES ('9999', 'Test USD', 'ASSET', 'USD')`);
    } finally {
      await owner.end();
    }

    await expect(
      postEntry(app, [
        ['9999', 'DEBIT', 100],
        ['4000', 'CREDIT', 100],
      ]),
    ).rejects.toMatchObject({
      code: '23514',
      message: expect.stringMatching(/currency/) as string,
    });
  });

  it('allows one entry per transaction_id', async () => {
    const transactionId = randomUUID();
    const lines: Line[] = [
      ['1100', 'DEBIT', 1000],
      ['4000', 'CREDIT', 1000],
    ];

    await postEntry(app, lines, { transactionId });
    await expect(postEntry(app, lines, { transactionId })).rejects.toMatchObject({ code: '23505' });
  });

  it('rejects unknown posting types', async () => {
    await expect(
      postEntry(
        app,
        [
          ['1100', 'DEBIT', 1000],
          ['4000', 'CREDIT', 1000],
        ],
        { postingType: 'REFUND' },
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('is append-only for ledger_app', async () => {
    const transactionId = await postEntry(app, [
      ['1100', 'DEBIT', 5000],
      ['4000', 'CREDIT', 5000],
    ]);

    await expect(
      app.query(
        `UPDATE ledger.journal_lines SET amount_minor = 1 WHERE journal_entry_id = (
                   SELECT id FROM ledger.journal_entries WHERE transaction_id = $1)`,
        [transactionId],
      ),
    ).rejects.toMatchObject({ code: '42501' });

    await expect(app.query('DELETE FROM ledger.journal_entries')).rejects.toMatchObject({
      code: '42501',
    });

    await expect(
      app.query(`UPDATE ledger.journal_entries SET description = 'x' WHERE transaction_id = $1`, [
        transactionId,
      ]),
    ).rejects.toMatchObject({ code: '42501' });
  });

  it('denies ledger_app access to the tickets schema', async () => {
    await expect(app.query('SELECT 1 FROM tickets.orders')).rejects.toMatchObject({
      code: '42501',
    });
  });
});
