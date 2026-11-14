import { startHttpStub, type HttpStub } from '@eticket/testing';
import request from 'supertest';
import { startGateway, type RunningGateway } from './support/app';

// Helmet's default CSP (script-src 'self') must not break Swagger UI: its page
// loads only same-origin scripts and styles, with no inline script.
describe('swagger ui under helmet', () => {
  let stub: HttpStub;
  let gw: RunningGateway;

  beforeAll(async () => {
    stub = await startHttpStub();
    gw = await startGateway(
      { ticket: stub, payment: stub, ledger: stub },
      { SWAGGER_ENABLED: 'true' },
    );
  });

  afterAll(async () => {
    await gw?.close();
    await stub?.close();
  });

  it('serves /docs with same-origin assets only and a script-src that allows them', async () => {
    const page = await request(gw.baseUrl).get('/docs');
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain("script-src 'self'");
    const scripts = [...page.text.matchAll(/<script([^>]*)>/g)].map((m) => m[1] ?? '');
    expect(scripts.length).toBeGreaterThan(0);
    for (const attrs of scripts) {
      expect(attrs).toMatch(/src="(\.\/|\/docs\/)[^"]+"/);
    }
    for (const asset of ['swagger-ui.css', 'swagger-ui-bundle.js', 'swagger-ui-init.js']) {
      const res = await request(gw.baseUrl).get(`/docs/${asset}`);
      expect(res.status).toBe(200);
    }
  });
});
