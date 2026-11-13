import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { PaymentContractTarget } from './target';

export function register(
  getTarget: () => PaymentContractTarget,
  validator: ContractValidator,
): void {
  describe('health', () => {
    it('live is 200 with no key and matches the contract', async () => {
      const res = await request(getTarget().baseUrl).get('/health/live');
      expect(res.status).toBe(200);
      validator.assertResponse('healthLive', res.status, res.body);
    });

    it('ready is 200 and matches the contract', async () => {
      const res = await request(getTarget().baseUrl).get('/health/ready');
      expect(res.status).toBe(200);
      validator.assertResponse('healthReady', res.status, res.body);
    });
  });
}
