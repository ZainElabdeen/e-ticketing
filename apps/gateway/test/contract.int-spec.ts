import { randomUUID } from 'node:crypto';
import { runGatewayContract } from '@eticket/contract-tests';
import { startHttpStub, type HttpStub, type StubCall, type StubReply } from '@eticket/testing';
import { startGateway, type RunningGateway } from './support/app';

const NOW = '2026-11-14T10:00:00.000Z';
const ref = {
  transactionId: randomUUID(),
  paymentReference: 'PAY-20261114-7F3K9Q',
  createdAt: NOW,
};
const ticketType = {
  code: 'GOLD',
  name: 'Gold',
  priceMinor: 10000,
  currency: 'AED',
  quota: 100,
  sold: 0,
  reserved: 1,
  available: 99,
};
const order = {
  id: randomUUID(),
  status: 'PENDING',
  items: [{ ticketTypeCode: 'GOLD', quantity: 1, unitPriceMinor: 10000, lineTotalMinor: 10000 }],
  totalMinor: 10000,
  currency: 'AED',
  createdAt: NOW,
  expiresAt: NOW,
  confirmedAt: null,
  paidTransactionId: null,
};
const payment = {
  id: randomUUID(),
  orderId: order.id,
  method: 'CARD',
  status: 'SUCCEEDED',
  amountMinor: 10000,
  currency: 'AED',
  cardLast4: '4242',
  qrPayload: null,
  transaction: ref,
  createdAt: NOW,
  succeededAt: NOW,
  cancelledAt: null,
};
const envelope = (statusCode: number, code: string) => ({
  statusCode,
  code,
  message: code,
  correlationId: 'stub',
});
const page = { page: 1, pageSize: 20, total: 0, data: [] };

describe('gateway contract (in-process, stubbed services, production rate limits)', () => {
  let stubs: { ticket: HttpStub; payment: HttpStub; ledger: HttpStub };
  let gw: RunningGateway;

  beforeAll(async () => {
    stubs = {
      ticket: await startHttpStub(),
      payment: await startHttpStub(),
      ledger: await startHttpStub(),
    };
    for (const stub of Object.values(stubs)) {
      stub.on('GET', /^\/health\/live$/, { status: 200, body: { status: 'ok' } });
    }
    stubs.ticket.on('GET', /^\/v1\/ticket-types$/, { status: 200, body: { data: [ticketType] } });
    stubs.ticket.on('POST', /^\/v1\/orders$/, (call: StubCall): StubReply => {
      const items = (call.body as { items?: unknown[] } | undefined)?.items;
      return Array.isArray(items) && items.length > 0
        ? { status: 201, body: order }
        : { status: 400, body: envelope(400, 'VALIDATION_ERROR') };
    });
    stubs.ticket.on('GET', /^\/v1\/orders\/[^/]+$/, { status: 200, body: order });

    const replayed = new Set<string>();
    stubs.payment.on('POST', /^\/v1\/payments$/, (call: StubCall): StubReply => {
      const key = String(call.headers['idempotency-key']);
      const replay = replayed.has(key);
      replayed.add(key);
      return {
        status: 201,
        body: payment,
        headers: replay ? { 'idempotent-replayed': 'true' } : {},
      };
    });
    stubs.payment.on('GET', /^\/v1\/payments\/[^/]+$/, (call: StubCall): StubReply =>
      call.path.endsWith(payment.id)
        ? { status: 200, body: payment }
        : { status: 404, body: envelope(404, 'PAYMENT_NOT_FOUND') },
    );
    stubs.payment.on('GET', /^\/v1\/transactions/, (call: StubCall): StubReply =>
      call.path.includes('pageSize=101')
        ? { status: 400, body: envelope(400, 'VALIDATION_ERROR') }
        : { status: 200, body: page },
    );
    stubs.ledger.on('GET', /^\/v1\/journal-entries/, { status: 200, body: page });
    stubs.ledger.on('GET', /^\/v1\/accounts/, {
      status: 200,
      body: { data: [], totals: { debitMinor: 0, creditMinor: 0 } },
    });

    // Limits at or below production (60 requests, 4 orders, 6 logins), so the suite proves it fits inside them.
    gw = await startGateway(stubs, {
      RATE_LIMIT_DEFAULT_PER_MIN: '60',
      RATE_LIMIT_ORDERS_PER_MIN: '4',
      RATE_LIMIT_LOGIN_PER_MIN: '6',
    });
  });

  afterAll(async () => {
    await gw?.close();
    for (const stub of Object.values(stubs ?? {})) {
      await stub.close();
    }
  });

  // At most 4 orders, 6 logins and 60 requests; the limits above are tighter than production.
  runGatewayContract(() => ({
    baseUrl: gw.baseUrl,
    adminEmail: gw.adminEmail,
    adminPassword: gw.adminPassword,
  }));
});
