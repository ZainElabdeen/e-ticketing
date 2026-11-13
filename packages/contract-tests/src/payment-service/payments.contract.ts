import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { PaymentContractTarget } from './target';

interface PaymentBody {
  id: string;
  status: string;
  qrPayload: string | null;
  transaction?: { transactionId: string; paymentReference: string };
}
interface Envelope {
  code: string;
}

const CARD = { number: '4242424242424242', expMonth: 12, expYear: 2099, cvc: '123', holder: 'Ada' };

function create(target: PaymentContractTarget, body: unknown, key: string | undefined) {
  const req = request(target.baseUrl).post('/v1/payments').set('X-Api-Key', target.publicApiKey);
  if (key !== undefined) req.set('Idempotency-Key', key);
  return req.send(body as object);
}

const newKey = () => `contract-${randomUUID()}`;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function register(
  getTarget: () => PaymentContractTarget,
  validator: ContractValidator,
): void {
  describe('payments', () => {
    it('card: 201 SUCCEEDED with a transaction and no replay header', async () => {
      const target = getTarget();
      const order = await target.newPayableOrder();
      const res = await create(target, { orderId: order.id, method: 'CARD', card: CARD }, newKey());
      expect(res.status).toBe(201);
      validator.assertResponse('createPayment', res.status, res.body);
      const body = res.body as PaymentBody & { amountMinor: number };
      expect(body.status).toBe('SUCCEEDED');
      expect(body.amountMinor).toBe(order.totalMinor);
      expect(body.transaction?.paymentReference).toMatch(/^PAY-\d{8}-[0-9A-Z]{6}$/);
      expect(res.headers['idempotent-replayed']).toBeUndefined();
    });

    it('replay: the same key and body -> 201, replay header, deep-equal body', async () => {
      const target = getTarget();
      const order = await target.newPayableOrder();
      const key = newKey();
      const payload = { orderId: order.id, method: 'CARD', card: CARD };
      const first = await create(target, payload, key);
      const second = await create(target, payload, key);
      expect(second.status).toBe(201);
      validator.assertResponse('createPayment', second.status, second.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
    });

    it('the same key with a different body -> 422 IDEMPOTENCY_KEY_REUSE', async () => {
      const target = getTarget();
      const order = await target.newPayableOrder();
      const key = newKey();
      await create(target, { orderId: order.id, method: 'CARD', card: CARD }, key);
      const res = await create(
        target,
        { orderId: order.id, method: 'CARD', card: { ...CARD, holder: 'Grace' } },
        key,
      );
      expect(res.status).toBe(422);
      validator.assertResponse('createPayment', res.status, res.body);
      expect((res.body as Envelope).code).toBe('IDEMPOTENCY_KEY_REUSE');
    });

    it('a missing key -> 400 VALIDATION_ERROR', async () => {
      const target = getTarget();
      const order = await target.newPayableOrder();
      const res = await create(target, { orderId: order.id, method: 'QR' }, undefined);
      expect(res.status).toBe(400);
      validator.assertResponse('createPayment', res.status, res.body);
      expect((res.body as Envelope).code).toBe('VALIDATION_ERROR');
    });

    it('a Luhn-invalid card -> 422 INVALID_CARD', async () => {
      const target = getTarget();
      const order = await target.newPayableOrder();
      const res = await create(
        target,
        { orderId: order.id, method: 'CARD', card: { ...CARD, number: '4242424242424241' } },
        newKey(),
      );
      expect(res.status).toBe(422);
      validator.assertResponse('createPayment', res.status, res.body);
      expect((res.body as Envelope).code).toBe('INVALID_CARD');
    });

    it('an unknown order -> 404 ORDER_NOT_FOUND', async () => {
      const target = getTarget();
      const res = await create(target, { orderId: randomUUID(), method: 'QR' }, newKey());
      expect(res.status).toBe(404);
      validator.assertResponse('createPayment', res.status, res.body);
      expect((res.body as Envelope).code).toBe('ORDER_NOT_FOUND');
    });

    // enabled in Task 6
    it.skip('QR: 201 PENDING, then polling reaches SUCCEEDED with a transaction', async () => {
      const target = getTarget();
      const order = await target.newPayableOrder();
      const res = await create(target, { orderId: order.id, method: 'QR' }, newKey());
      expect(res.status).toBe(201);
      validator.assertResponse('createPayment', res.status, res.body);
      const created = res.body as PaymentBody;
      expect(created.status).toBe('PENDING');
      expect(created.qrPayload).toBe(`eticket:pay:${created.id}`);

      const deadline = Date.now() + (target.qrDelaySeconds + 5) * 1000;
      let current: PaymentBody = created;
      while (current.status !== 'SUCCEEDED' && Date.now() < deadline) {
        await sleep(500);
        const poll = await request(target.baseUrl)
          .get(`/v1/payments/${created.id}`)
          .set('X-Api-Key', target.publicApiKey);
        expect(poll.status).toBe(200);
        validator.assertResponse('getPayment', poll.status, poll.body);
        current = poll.body as PaymentBody;
      }
      expect(current.status).toBe('SUCCEEDED');
      expect(current.transaction?.transactionId).toEqual(expect.any(String));
    });

    it('a second payment for a paid order -> 409 ORDER_ALREADY_PAID', async () => {
      const target = getTarget();
      const order = await target.newPayableOrder();
      const first = await create(
        target,
        { orderId: order.id, method: 'CARD', card: CARD },
        newKey(),
      );
      expect(first.status).toBe(201);
      const res = await create(target, { orderId: order.id, method: 'QR' }, newKey());
      expect(res.status).toBe(409);
      validator.assertResponse('createPayment', res.status, res.body);
      expect((res.body as Envelope).code).toBe('ORDER_ALREADY_PAID');
    });
  });
}
