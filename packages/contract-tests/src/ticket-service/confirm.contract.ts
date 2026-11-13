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
  confirmedAt: string | null;
  paidTransactionId: string | null;
}
interface TicketTypeRow {
  code: string;
  sold: number;
  reserved: number;
}

async function gold(target: ContractTarget): Promise<{ sold: number; reserved: number }> {
  const res = await request(target.baseUrl)
    .get('/v1/ticket-types')
    .set('X-Api-Key', target.publicApiKey);
  const row = (res.body as { data: TicketTypeRow[] }).data.find((r) => r.code === 'GOLD');
  if (!row) throw new Error('GOLD missing');
  return { sold: row.sold, reserved: row.reserved };
}

async function createGold(target: ContractTarget, quantity: number): Promise<OrderBody> {
  const res = await request(target.baseUrl)
    .post('/v1/orders')
    .set('X-Api-Key', target.publicApiKey)
    .send({ items: [{ ticketTypeCode: 'GOLD', quantity }] });
  expect(res.status).toBe(201);
  return res.body as OrderBody;
}

function confirm(target: ContractTarget, orderId: string, body: unknown, key?: string) {
  return request(target.baseUrl)
    .post(`/v1/internal/orders/${orderId}/confirm`)
    .set('X-Api-Key', key ?? target.internalApiKey)
    .send(body as object);
}

export function register(getTarget: () => ContractTarget, validator: ContractValidator): void {
  describe('confirm order', () => {
    const T = randomUUID();
    const U = randomUUID();
    let firstOrderId = '';
    let firstBody: unknown;

    it('moves reserved to sold and marks the order CONFIRMED', async () => {
      const target = getTarget();
      const order = await createGold(target, 2);
      firstOrderId = order.id;
      const before = await gold(target);
      const res = await confirm(target, order.id, { transactionId: T });
      expect(res.status).toBe(200);
      validator.assertResponse('confirmOrder', res.status, res.body);
      const body = res.body as OrderBody;
      expect(body.status).toBe('CONFIRMED');
      expect(body.paidTransactionId).toBe(T);
      expect(body.confirmedAt).not.toBeNull();
      firstBody = res.body;
      const after = await gold(target);
      expect(after.sold - before.sold).toBe(2);
      expect(after.reserved - before.reserved).toBe(-2);
    });

    it('replays the same transaction with an identical 200 body', async () => {
      const target = getTarget();
      const before = await gold(target);
      const res = await confirm(target, firstOrderId, { transactionId: T });
      expect(res.status).toBe(200);
      validator.assertResponse('confirmOrder', res.status, res.body);
      expect(res.body).toEqual(firstBody);
      expect(await gold(target)).toEqual(before);
    });

    it('rejects a different transaction on a confirmed order with 409', async () => {
      const target = getTarget();
      const res = await confirm(target, firstOrderId, { transactionId: U });
      expect(res.status).toBe(409);
      validator.assertResponse('confirmOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('ORDER_NOT_CONFIRMABLE');
    });

    it('rejects a transaction id already used by another order with 409', async () => {
      const target = getTarget();
      const order = await createGold(target, 1);
      const res = await confirm(target, order.id, { transactionId: T });
      expect(res.status).toBe(409);
      validator.assertResponse('confirmOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('ORDER_NOT_CONFIRMABLE');
    });

    it('returns 404 NOT_FOUND for an unknown order', async () => {
      const res = await confirm(getTarget(), randomUUID(), { transactionId: randomUUID() });
      expect(res.status).toBe(404);
      validator.assertResponse('confirmOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('NOT_FOUND');
    });

    it.each([
      ['empty object', {}],
      ['non-uuid transaction id', { transactionId: 'x' }],
      ['extra field', { transactionId: randomUUID(), extra: 1 }],
    ])('rejects %s with 400 VALIDATION_ERROR', async (_name, body) => {
      const res = await confirm(getTarget(), randomUUID(), body);
      expect(res.status).toBe(400);
      validator.assertResponse('confirmOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('VALIDATION_ERROR');
    });

    it('rejects the public key with 403 FORBIDDEN', async () => {
      const target = getTarget();
      const res = await confirm(
        target,
        randomUUID(),
        { transactionId: randomUUID() },
        target.publicApiKey,
      );
      expect(res.status).toBe(403);
      expect((res.body as Envelope).code).toBe('FORBIDDEN');
    });

    it('accepts the internal key on GET /v1/orders/{id}', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .get(`/v1/orders/${firstOrderId}`)
        .set('X-Api-Key', target.internalApiKey);
      expect(res.status).toBe(200);
      validator.assertResponse('getOrder', res.status, res.body);
    });
  });
}
