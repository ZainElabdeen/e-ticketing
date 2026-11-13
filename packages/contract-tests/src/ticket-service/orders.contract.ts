import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ContractTarget } from '../target';
import type { ContractValidator } from '../validator';

interface Envelope {
  code: string;
}
interface OrderBody {
  id: string;
  status: string;
  items: Array<{
    ticketTypeCode: string;
    quantity: number;
    unitPriceMinor: number;
    lineTotalMinor: number;
  }>;
  totalMinor: number;
  currency: string;
  createdAt: string;
  expiresAt: string;
  confirmedAt: string | null;
  paidTransactionId: string | null;
}
interface TicketTypeRow {
  code: string;
  available: number;
}

const GOLD = { ticketTypeCode: 'GOLD', quantity: 1 };

async function availability(
  target: ContractTarget,
): Promise<Record<'GOLD' | 'PREMIUM' | 'VIP', number>> {
  const res = await request(target.baseUrl)
    .get('/v1/ticket-types')
    .set('X-Api-Key', target.publicApiKey);
  const rows = (res.body as { data: TicketTypeRow[] }).data;
  const out = { GOLD: 0, PREMIUM: 0, VIP: 0 };
  for (const r of rows) {
    out[r.code as keyof typeof out] = r.available;
  }
  return out;
}

function post(target: ContractTarget, body: unknown) {
  return request(target.baseUrl)
    .post('/v1/orders')
    .set('X-Api-Key', target.publicApiKey)
    .send(body as object);
}

export function register(getTarget: () => ContractTarget, validator: ContractValidator): void {
  describe('orders', () => {
    it('creates a server-priced PENDING order and reserves quota', async () => {
      const target = getTarget();
      const before = await availability(target);
      const res = await post(target, {
        items: [
          { ticketTypeCode: 'GOLD', quantity: 2 },
          { ticketTypeCode: 'VIP', quantity: 1 },
        ],
      });
      expect(res.status).toBe(201);
      validator.assertResponse('createOrder', res.status, res.body);
      const order = res.body as OrderBody;
      expect(order.status).toBe('PENDING');
      expect(order.totalMinor).toBe(70000);
      expect(order.currency).toBe('AED');
      const byCode = new Map(order.items.map((i) => [i.ticketTypeCode, i]));
      expect(byCode.get('GOLD')).toMatchObject({ unitPriceMinor: 10000, lineTotalMinor: 20000 });
      expect(byCode.get('VIP')).toMatchObject({ unitPriceMinor: 50000, lineTotalMinor: 50000 });
      expect(order.confirmedAt).toBeNull();
      expect(order.paidTransactionId).toBeNull();
      const ttlMs = (target.orderTtlMinutes ?? 15) * 60_000;
      const delta = Date.parse(order.expiresAt) - Date.parse(order.createdAt);
      expect(Math.abs(delta - ttlMs)).toBeLessThanOrEqual(5_000);

      const after = await availability(target);
      expect(before.GOLD - after.GOLD).toBe(2);
      expect(before.VIP - after.VIP).toBe(1);
    });

    it('reads an order back identically', async () => {
      const target = getTarget();
      const created = await post(target, { items: [GOLD] });
      const res = await request(target.baseUrl)
        .get(`/v1/orders/${(created.body as OrderBody).id}`)
        .set('X-Api-Key', target.publicApiKey);
      expect(res.status).toBe(200);
      validator.assertResponse('getOrder', res.status, res.body);
      expect(res.body).toEqual(created.body);
    });

    it('returns 404 NOT_FOUND for an unknown order', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .get(`/v1/orders/${randomUUID()}`)
        .set('X-Api-Key', target.publicApiKey);
      expect(res.status).toBe(404);
      validator.assertResponse('getOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('NOT_FOUND');
    });

    it('returns 400 VALIDATION_ERROR for a non-UUID order id', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .get('/v1/orders/not-a-uuid')
        .set('X-Api-Key', target.publicApiKey);
      expect(res.status).toBe(400);
      validator.assertResponse('getOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('VALIDATION_ERROR');
    });

    it.each([
      ['empty object', {}],
      ['empty items', { items: [] }],
      ['four items', { items: [GOLD, GOLD, GOLD, GOLD] }],
      ['quantity 0', { items: [{ ticketTypeCode: 'GOLD', quantity: 0 }] }],
      ['quantity 11', { items: [{ ticketTypeCode: 'GOLD', quantity: 11 }] }],
      ['string quantity', { items: [{ ticketTypeCode: 'GOLD', quantity: '2' }] }],
      ['fractional quantity', { items: [{ ticketTypeCode: 'GOLD', quantity: 1.5 }] }],
      ['unknown code', { items: [{ ticketTypeCode: 'BRONZE', quantity: 1 }] }],
      ['duplicate code', { items: [GOLD, GOLD] }],
      ['extra top-level field', { items: [GOLD], totalMinor: 1 }],
      ['extra item field', { items: [{ ...GOLD, unitPriceMinor: 1 }] }],
    ])('rejects %s with 400 VALIDATION_ERROR', async (_name, body) => {
      const res = await post(getTarget(), body);
      expect(res.status).toBe(400);
      validator.assertResponse('createOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('VALIDATION_ERROR');
    });

    it('rejects a malformed JSON body with 400 VALIDATION_ERROR', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .post('/v1/orders')
        .set('X-Api-Key', target.publicApiKey)
        .set('Content-Type', 'application/json')
        .send('{"items":');
      expect(res.status).toBe(400);
      validator.assertResponse('createOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('VALIDATION_ERROR');
    });
  });
}

/** Drains VIP, so it must be registered after every other area. */
export function registerQuotaDrain(
  getTarget: () => ContractTarget,
  validator: ContractValidator,
): void {
  describe('orders quota drain', () => {
    it('returns 409 QUOTA_EXCEEDED and rolls back the other lines', async () => {
      const target = getTarget();
      let available = (await availability(target)).VIP;
      while (available >= 10) {
        expect(
          (await post(target, { items: [{ ticketTypeCode: 'VIP', quantity: 10 }] })).status,
        ).toBe(201);
        available -= 10;
      }
      if (available > 0) {
        expect(
          (await post(target, { items: [{ ticketTypeCode: 'VIP', quantity: available }] })).status,
        ).toBe(201);
      }
      const before = await availability(target);
      expect(before.VIP).toBe(0);

      const res = await post(target, {
        items: [
          { ticketTypeCode: 'GOLD', quantity: 1 },
          { ticketTypeCode: 'VIP', quantity: 1 },
        ],
      });
      expect(res.status).toBe(409);
      validator.assertResponse('createOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('QUOTA_EXCEEDED');
      expect((await availability(target)).GOLD).toBe(before.GOLD);
    });
  });
}
