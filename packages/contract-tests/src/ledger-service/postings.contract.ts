import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { LedgerContractTarget } from './target';

/** A fresh transactionId per call keeps every test independent of the target's data. */
const posting = (over: Record<string, unknown> = {}) => ({
  transactionId: randomUUID(),
  postingType: 'TICKET_SALE',
  orderId: randomUUID(),
  paymentReference: 'PAY-20261113-7F3K9Q',
  amountMinor: 70000,
  currency: 'AED',
  ...over,
});

export function register(
  getTarget: () => LedgerContractTarget,
  validator: ContractValidator,
): void {
  const post = (body: unknown) => {
    const target = getTarget();
    return request(target.baseUrl)
      .post('/v1/internal/postings')
      .set('X-Api-Key', target.internalApiKey)
      .send(body as object);
  };

  describe('postings', () => {
    it('creates an entry with 201 matching the contract', async () => {
      const res = await post(posting());
      expect(res.status).toBe(201);
      validator.assertResponse('createPosting', res.status, res.body);
    });

    it('replays the same posting with 200 and an equal body', async () => {
      const p = posting();
      const first = await post(p);
      const second = await post(p);
      expect(second.status).toBe(200);
      validator.assertResponse('createPosting', second.status, second.body);
      expect(second.body).toEqual(first.body);
    });

    it('answers a different amount for the same transactionId with 409', async () => {
      const p = posting();
      await post(p);
      const res = await post({ ...p, amountMinor: p.amountMinor + 1 });
      expect(res.status).toBe(409);
      validator.assertResponse('createPosting', res.status, res.body);
      expect((res.body as { code: string }).code).toBe('POSTING_CONFLICT');
    });

    it('answers an unsupported currency with 400', async () => {
      const res = await post(posting({ currency: 'USD' }));
      expect(res.status).toBe(400);
      validator.assertResponse('createPosting', res.status, res.body);
    });

    it('answers an invalid body with 400', async () => {
      const res = await post({ ...posting(), amountMinor: 0 });
      expect(res.status).toBe(400);
      validator.assertResponse('createPosting', res.status, res.body);
    });
  });
}
