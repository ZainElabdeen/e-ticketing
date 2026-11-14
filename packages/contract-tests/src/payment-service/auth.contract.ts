import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { PaymentContractTarget } from './target';

interface Envelope {
  statusCode: number;
  code: string;
  correlationId: string;
}

export function register(
  getTarget: () => PaymentContractTarget,
  validator: ContractValidator,
): void {
  describe('auth', () => {
    it('rejects a missing key with 401 UNAUTHORIZED', async () => {
      const res = await request(getTarget().baseUrl).get(`/v1/payments/${randomUUID()}`);
      expect(res.status).toBe(401);
      validator.assertResponse('getPayment', res.status, res.body);
      expect((res.body as Envelope).code).toBe('UNAUTHORIZED');
    });

    it('rejects a wrong key with 401 UNAUTHORIZED', async () => {
      const res = await request(getTarget().baseUrl)
        .get(`/v1/payments/${randomUUID()}`)
        .set('X-Api-Key', 'x'.repeat(40));
      expect(res.status).toBe(401);
      validator.assertResponse('getPayment', res.status, res.body);
      expect((res.body as Envelope).code).toBe('UNAUTHORIZED');
    });

    it('answers an unknown route with the key as a 404 NOT_FOUND envelope', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .get('/v1/nope')
        .set('X-Api-Key', target.publicApiKey);
      const body = res.body as Envelope;
      expect(res.status).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
      expect(typeof body.correlationId).toBe('string');
    });
  });
}
