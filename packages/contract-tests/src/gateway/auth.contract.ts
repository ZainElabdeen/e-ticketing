import request from 'supertest';
import type { ContractValidator } from '../validator';
import type { GatewayContext } from './context';
import type { GatewayContractTarget } from './target';

interface Envelope {
  code: string;
}

// Logins: 3 here (plus at most 1 lazy login if this area is skipped).
export function register(
  getTarget: () => GatewayContractTarget,
  validator: ContractValidator,
  ctx: GatewayContext,
): void {
  describe('auth', () => {
    it('a good login is 200 with a token and matches the contract', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .post('/v1/auth/login')
        .send({ email: target.adminEmail, password: target.adminPassword });
      expect(res.status).toBe(200);
      validator.assertResponse('login', res.status, res.body);
      const body = res.body as { accessToken: string; expiresIn: number };
      expect(body.expiresIn).toBe(3600);
      ctx.remember(body.accessToken);
    });

    it('a bad password is 401 INVALID_CREDENTIALS', async () => {
      const target = getTarget();
      const res = await request(target.baseUrl)
        .post('/v1/auth/login')
        .send({ email: target.adminEmail, password: 'wrong-password-123' });
      expect(res.status).toBe(401);
      validator.assertResponse('login', res.status, res.body);
      expect((res.body as Envelope).code).toBe('INVALID_CREDENTIALS');
    });

    it('a bad body is 400 VALIDATION_ERROR', async () => {
      const res = await request(getTarget().baseUrl)
        .post('/v1/auth/login')
        .send({ email: 'not-an-email' });
      expect(res.status).toBe(400);
      validator.assertResponse('login', res.status, res.body);
      expect((res.body as Envelope).code).toBe('VALIDATION_ERROR');
    });
  });
}
