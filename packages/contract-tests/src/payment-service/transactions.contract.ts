import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { PaymentContractTarget } from './target';

const CARD = { number: '4242424242424242', expMonth: 12, expYear: 2099, cvc: '123', holder: 'Ada' };

export function register(
  getTarget: () => PaymentContractTarget,
  validator: ContractValidator,
): void {
  describe('transactions', () => {
    it('lists transactions: 200 matching listTransactions', async () => {
      const target = getTarget();
      const order = await target.newPayableOrder();
      const created = await request(target.baseUrl)
        .post('/v1/payments')
        .set('X-Api-Key', target.publicApiKey)
        .set('Idempotency-Key', `contract-tx-${order.id}`)
        .send({ orderId: order.id, method: 'CARD', card: CARD });
      expect(created.status).toBe(201);

      const res = await request(target.baseUrl)
        .get('/v1/transactions?page=1&pageSize=5')
        .set('X-Api-Key', target.publicApiKey);
      expect(res.status).toBe(200);
      validator.assertResponse('listTransactions', res.status, res.body);
      const body = res.body as { data: unknown[]; total: number };
      expect(body.data.length).toBeGreaterThan(0);
      expect(body.total).toBeGreaterThan(0);
    });

    it('pageSize=101 -> 400 VALIDATION_ERROR', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .get('/v1/transactions?pageSize=101')
        .set('X-Api-Key', target.publicApiKey);
      expect(res.status).toBe(400);
      expect((res.body as { code: string }).code).toBe('VALIDATION_ERROR');
    });
  });
}
