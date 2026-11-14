import request from 'supertest';
import type { GatewayContractTarget } from './target';

/**
 * State shared by the areas, so the whole suite stays inside the production
 * rate limits (at most 4 order creations, 6 logins and 60 requests in total):
 * one JWT is obtained once and reused.
 */
export interface GatewayContext {
  /** The shared admin JWT; logs in on first use. */
  token(): Promise<string>;
  /** Records a token obtained by the auth area's own login test. */
  remember(token: string): void;
}

export function createContext(getTarget: () => GatewayContractTarget): GatewayContext {
  let cached: string | undefined;
  return {
    async token() {
      if (!cached) {
        const target = getTarget();
        const res = await request(target.baseUrl)
          .post('/v1/auth/login')
          .send({ email: target.adminEmail, password: target.adminPassword });
        if (res.status !== 200) {
          throw new Error(`Admin login failed with HTTP ${res.status}`);
        }
        cached = (res.body as { accessToken: string }).accessToken;
      }
      return cached;
    },
    remember(token) {
      cached = token;
    },
  };
}
