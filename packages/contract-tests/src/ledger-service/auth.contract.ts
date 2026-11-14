import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { LedgerContractTarget } from './target';

interface Envelope {
  statusCode: number;
  code: string;
  correlationId: string;
}

const body = () => ({
  transactionId: randomUUID(),
  postingType: 'TICKET_SALE',
  orderId: randomUUID(),
  paymentReference: 'PAY-20261113-7F3K9Q',
  amountMinor: 10000,
  currency: 'AED',
});

export function register(
  getTarget: () => LedgerContractTarget,
  validator: ContractValidator,
): void {
  describe('auth', () => {
    it('rejects a missing key with 401 UNAUTHORIZED', async () => {
      const res = await request(getTarget().baseUrl).post('/v1/internal/postings').send(body());
      expect(res.status).toBe(401);
      validator.assertResponse('createPosting', res.status, res.body);
      expect((res.body as Envelope).code).toBe('UNAUTHORIZED');
    });

    it('rejects the public key on postings with 403 FORBIDDEN', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .post('/v1/internal/postings')
        .set('X-Api-Key', target.publicApiKey)
        .send(body());
      expect(res.status).toBe(403);
      validator.assertResponse('createPosting', res.status, res.body);
      expect((res.body as Envelope).code).toBe('FORBIDDEN');
    });

    it('answers an unknown route with the key as a 404 NOT_FOUND envelope', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .get('/v1/nope')
        .set('X-Api-Key', target.publicApiKey);
      const env = res.body as Envelope;
      expect(res.status).toBe(404);
      expect(env.code).toBe('NOT_FOUND');
      expect(typeof env.correlationId).toBe('string');
    });
  });
}
