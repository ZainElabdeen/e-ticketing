import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { GatewayContext } from './context';
import type { GatewayContractTarget } from './target';

const ROUTES: Array<[path: string, operationId: string]> = [
  ['/v1/backoffice/transactions', 'backofficeTransactions'],
  ['/v1/backoffice/ledger-entries', 'backofficeLedgerEntries'],
  ['/v1/backoffice/accounts', 'backofficeAccounts'],
  ['/v1/backoffice/ticket-availability', 'backofficeTicketAvailability'],
];

// Requests: 6, all with the one shared token.
export function register(
  getTarget: () => GatewayContractTarget,
  validator: ContractValidator,
  ctx: GatewayContext,
): void {
  describe('backoffice', () => {
    it.each(ROUTES)('GET %s with a token is 200 and matches the contract', async (path, op) => {
      const res = await request(getTarget().baseUrl)
        .get(path)
        .set('Authorization', `Bearer ${await ctx.token()}`);
      expect(res.status).toBe(200);
      validator.assertResponse(op, res.status, res.body);
    });

    it('a request without a token is 401', async () => {
      const res = await request(getTarget().baseUrl).get('/v1/backoffice/accounts');
      expect(res.status).toBe(401);
      expect((res.body as { code: string }).code).toBe('UNAUTHORIZED');
    });

    it('pageSize=101 is a passed-through 400', async () => {
      const res = await request(getTarget().baseUrl)
        .get('/v1/backoffice/transactions?pageSize=101')
        .set('Authorization', `Bearer ${await ctx.token()}`);
      expect(res.status).toBe(400);
      validator.assertResponse('backofficeTransactions', res.status, res.body);
    });
  });
}
