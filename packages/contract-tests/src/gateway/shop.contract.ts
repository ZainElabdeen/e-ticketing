import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { GatewayContractTarget } from './target';

interface Envelope {
  code: string;
}
interface Order {
  id: string;
}

const CARD = { number: '4242424242424242', expMonth: 12, expYear: 2099, cvc: '123', holder: 'Ada' };

// Order creations: 2 (one good, one bad). Requests: 8.
export function register(
  getTarget: () => GatewayContractTarget,
  validator: ContractValidator,
): void {
  describe('shop', () => {
    let orderId: string;
    let paymentId: string;
    const key = `contract-${randomUUID()}`;

    it('GET /v1/ticket-types is 200 and matches the contract', async () => {
      const res = await request(getTarget().baseUrl).get('/v1/ticket-types');
      expect(res.status).toBe(200);
      validator.assertResponse('listTicketTypes', res.status, res.body);
    });

    it('POST /v1/orders is 201, then GET /v1/orders/{id} is 200', async () => {
      const { baseUrl } = getTarget();
      const created = await request(baseUrl)
        .post('/v1/orders')
        .send({ items: [{ ticketTypeCode: 'GOLD', quantity: 1 }] });
      expect(created.status).toBe(201);
      validator.assertResponse('createOrder', created.status, created.body);
      orderId = (created.body as Order).id;

      const got = await request(baseUrl).get(`/v1/orders/${orderId}`);
      expect(got.status).toBe(200);
      validator.assertResponse('getOrder', got.status, got.body);
      expect((got.body as Order).id).toBe(orderId);
    });

    it('a bad order body is 400 with the downstream VALIDATION_ERROR envelope', async () => {
      const res = await request(getTarget().baseUrl).post('/v1/orders').send({ items: [] });
      expect(res.status).toBe(400);
      validator.assertResponse('createOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('VALIDATION_ERROR');
    });

    it('POST /v1/payments with a card is 201, and the same request replays', async () => {
      const { baseUrl } = getTarget();
      const send = () =>
        request(baseUrl)
          .post('/v1/payments')
          .set('Idempotency-Key', key)
          .send({ orderId, method: 'CARD', card: CARD });
      const first = await send();
      expect(first.status).toBe(201);
      validator.assertResponse('createPayment', first.status, first.body);
      expect(first.headers['idempotent-replayed']).toBeUndefined();
      paymentId = (first.body as Order).id;

      const second = await send();
      expect(second.status).toBe(201);
      validator.assertResponse('createPayment', second.status, second.body);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
    });

    it('GET /v1/payments/{id} is 200', async () => {
      const res = await request(getTarget().baseUrl).get(`/v1/payments/${paymentId}`);
      expect(res.status).toBe(200);
      validator.assertResponse('getPayment', res.status, res.body);
    });

    it('an unknown payment id is 404', async () => {
      const res = await request(getTarget().baseUrl).get(`/v1/payments/${randomUUID()}`);
      expect(res.status).toBe(404);
      validator.assertResponse('getPayment', res.status, res.body);
    });
  });
}
