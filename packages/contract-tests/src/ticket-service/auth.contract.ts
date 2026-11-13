import { randomUUID } from 'node:crypto';
import request from 'supertest';
import type { ContractTarget } from '../target';
import type { ContractValidator } from '../validator';

interface Envelope {
  statusCode: number;
  code: string;
  message: string;
  correlationId: string;
}

export function register(getTarget: () => ContractTarget, validator: ContractValidator): void {
  describe('auth and correlation', () => {
    const confirmPath = () => `/v1/internal/orders/${randomUUID()}/confirm`;

    it('rejects a missing key with 401 UNAUTHORIZED', async () => {
      const res = await request(getTarget().baseUrl).get('/v1/ticket-types');
      expect(res.status).toBe(401);
      validator.assertResponse('listTicketTypes', res.status, res.body);
      expect((res.body as Envelope).code).toBe('UNAUTHORIZED');
    });

    it('rejects an unknown key with 401', async () => {
      const res = await request(getTarget().baseUrl)
        .get('/v1/ticket-types')
        .set('X-Api-Key', 'x'.repeat(40));
      expect(res.status).toBe(401);
      validator.assertResponse('listTicketTypes', res.status, res.body);
      expect((res.body as Envelope).code).toBe('UNAUTHORIZED');
    });

    it('rejects the public key on an internal route with 403 FORBIDDEN', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .post(confirmPath())
        .set('X-Api-Key', target.publicApiKey)
        .send({ transactionId: randomUUID() });
      expect(res.status).toBe(403);
      validator.assertResponse('confirmOrder', res.status, res.body);
      expect((res.body as Envelope).code).toBe('FORBIDDEN');
    });

    it('answers an unknown route with a 404 NOT_FOUND envelope', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .get('/v1/nope')
        .set('X-Api-Key', target.publicApiKey);
      const body = res.body as Envelope;
      expect(res.status).toBe(404);
      expect(body.statusCode).toBe(404);
      expect(body.code).toBe('NOT_FOUND');
      expect(typeof body.message).toBe('string');
      expect(typeof body.correlationId).toBe('string');
    });

    it('echoes a supplied correlation id in the body and the response header', async () => {
      const id = randomUUID();
      const res = await request(getTarget().baseUrl)
        .get('/v1/ticket-types')
        .set('X-Correlation-Id', id);
      expect(res.status).toBe(401);
      expect((res.body as Envelope).correlationId).toBe(id);
      expect(res.headers['x-correlation-id']).toBe(id);
    });
  });
}
