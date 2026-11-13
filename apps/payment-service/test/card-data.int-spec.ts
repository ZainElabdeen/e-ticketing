import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { Writable } from 'node:stream';
import request from 'supertest';
import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import { startPaymentService, type RunningPaymentService } from './support/app';
import { CVC, PAN, cardBody, newKey, postPayment, validCard } from './support/payments';
import { stubPayableOrder } from './support/stubs';

type Client = Awaited<ReturnType<TestDatabase['connectAs']>>;

const INVALID_PAN = '4242424242424241';

describe('card data never leaks', () => {
  let db: TestDatabase;
  let ticket: HttpStub;
  let ledger: HttpStub;
  let svc: RunningPaymentService;
  let sql: Client;
  const logs: string[] = [];

  beforeAll(async () => {
    db = await startTestDatabase();
    applyMigrations(db, 'payment-service');
    ticket = await startHttpStub();
    ledger = await startHttpStub();
    const logStream = new Writable({
      write(chunk: Buffer, _enc, cb) {
        logs.push(chunk.toString('utf8'));
        cb();
      },
    });
    svc = await startPaymentService(db, { ticket, ledger }, { LOG_LEVEL: 'trace' }, { logStream });
    sql = await db.connectAs('payments_app');
  });

  afterAll(async () => {
    await svc?.close();
    await sql?.end();
    await ticket?.close();
    await ledger?.close();
    await db?.stop();
  });

  it('keeps the PAN and CVC out of rows, logs and responses', async () => {
    const order = stubPayableOrder(ticket);
    const key = newKey();
    const responses = [
      await postPayment(svc, cardBody(order.id), key),
      await postPayment(svc, cardBody(order.id), key),
      await postPayment(svc, cardBody(order.id, validCard({ number: INVALID_PAN })), newKey()),
    ];
    expect(responses.map((r) => r.status)).toEqual([201, 201, 422]);

    const texts = {
      payments: (
        await sql.query<{ t: string }>(`SELECT row_to_json(p)::text AS t FROM payments.payments p`)
      ).rows,
      keys: (
        await sql.query<{ t: string }>(
          `SELECT row_to_json(k)::text AS t FROM payments.idempotency_keys k`,
        )
      ).rows,
      outbox: (
        await sql.query<{ t: string }>(`SELECT payload::text AS t FROM payments.outbox_events`)
      ).rows,
      transactions: (
        await sql.query<{ t: string }>(
          `SELECT row_to_json(x)::text AS t FROM payments.transactions x`,
        )
      ).rows,
    };
    const dbText = Object.values(texts)
      .flat()
      .map((r) => r.t)
      .join('\n');
    const logText = logs.join('');
    const responseText = responses.map((r) => r.text).join('\n');

    expect(dbText.length).toBeGreaterThan(0);
    expect(logText.length).toBeGreaterThan(0);
    for (const [name, text] of [
      ['db', dbText],
      ['logs', logText],
      ['responses', responseText],
    ] as const) {
      expect([name, text.includes(PAN)]).toEqual([name, false]);
      expect([name, text.includes(INVALID_PAN)]).toEqual([name, false]);
    }
    for (const [name, text] of [
      ['db', dbText],
      ['logs', logText],
    ] as const) {
      expect([name, text.includes('"cvc"')]).toEqual([name, false]);
      expect([name, text.includes(`"cvc":"${CVC}"`)]).toEqual([name, false]);
    }
    expect(dbText).toContain('4242');
  });

  it('answers a malformed JSON body with a fixed message that never echoes card data', async () => {
    const mark = logs.length;
    const raw = `{"orderId":"${randomUUID()}","method":"CARD","card":{"number":"${PAN}","cvc":"${CVC}","x":y}}`;
    const res = await request(svc.baseUrl)
      .post('/v1/payments')
      .set('X-Api-Key', svc.publicKey)
      .set('Idempotency-Key', newKey())
      .set('Content-Type', 'application/json')
      .send(raw);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR', message: 'Malformed JSON body' });
    await setTimeout(100); // let any request log line land before reading the capture
    const logText = logs.slice(mark).join('');
    for (const [name, text] of [
      ['response', res.text],
      ['logs', logText],
    ] as const) {
      for (const needle of [PAN, '424242', `"${CVC}"`, `${CVC}","`]) {
        expect([name, needle, text.includes(needle)]).toEqual([name, needle, false]);
      }
    }
  });
});
