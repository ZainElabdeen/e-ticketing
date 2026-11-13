import request from 'supertest';
import type { ContractTarget } from '../target';
import type { ContractValidator } from '../validator';

interface TicketTypeRow {
  code: string;
  priceMinor: number;
  currency: string;
  quota: number;
  sold: number;
  reserved: number;
  available: number;
}

export function register(getTarget: () => ContractTarget, validator: ContractValidator): void {
  describe('ticket types', () => {
    it('lists the three seeded types with live availability', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .get('/v1/ticket-types')
        .set('X-Api-Key', target.publicApiKey);
      expect(res.status).toBe(200);
      validator.assertResponse('listTicketTypes', res.status, res.body);

      const rows = (res.body as { data: TicketTypeRow[] }).data;
      expect(rows.map((t) => t.code)).toEqual(['GOLD', 'PREMIUM', 'VIP']);
      expect(rows.map((t) => t.priceMinor)).toEqual([10000, 20000, 50000]);
      for (const t of rows) {
        expect(t.currency).toBe('AED');
        expect(t.quota).toBe(100);
        expect(t.available).toBe(t.quota - t.sold - t.reserved);
      }
    });
  });
}
