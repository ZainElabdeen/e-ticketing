import request from 'supertest';
import type { GatewayContractTarget } from './target';

// Requests: 4. None of these carry a key or a token: the allow-list answers first.
export function register(getTarget: () => GatewayContractTarget): void {
  describe('allow-list', () => {
    it.each([
      ['get', '/v1/transactions'],
      ['get', '/v1/journal-entries'],
      ['get', '/v1/accounts'],
      ['post', '/v1/internal/postings'],
    ] as const)('%s %s is 404 NOT_FOUND', async (method, path) => {
      const res = await request(getTarget().baseUrl)[method](path);
      expect(res.status).toBe(404);
      expect((res.body as { code: string }).code).toBe('NOT_FOUND');
    });
  });
}
