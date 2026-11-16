import type { Server } from 'node:http';
import { Injectable, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from './health.module';
import type { ReadinessCheck } from './readiness-check';

@Injectable()
class UpCheck implements ReadinessCheck {
  readonly name = 'up-dep';
  check(): Promise<void> {
    return Promise.resolve();
  }
}

@Injectable()
class DownCheck implements ReadinessCheck {
  readonly name = 'down-dep';
  check(): Promise<void> {
    return Promise.reject(new Error('boom'));
  }
}

@Injectable()
class HungCheck implements ReadinessCheck {
  readonly name = 'hung-dep';
  check(): Promise<void> {
    return new Promise<void>(() => undefined);
  }
}

async function appWith(
  checks: (new () => ReadinessCheck)[],
  opts: { timeoutMs?: number; drainMs?: number } = {},
): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    imports: [HealthModule.forRoot({ checks, drainMs: 0, ...opts })],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

type Body = { status: string; details: Record<string, { status: string }> };
const server = (a: INestApplication) => a.getHttpServer() as Server;

describe('HealthModule', () => {
  let app: INestApplication | undefined;
  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('live is 200 ok even when a check fails', async () => {
    app = await appWith([DownCheck]);
    const res = await request(server(app)).get('/health/live').expect(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  it('ready is 200 with every check up', async () => {
    app = await appWith([UpCheck]);
    const res = await request(server(app)).get('/health/ready').expect(200);
    expect((res.body as Body).status).toBe('ok');
    expect((res.body as Body).details['up-dep']?.status).toBe('up');
  });

  it('ready is 503 naming the failing check', async () => {
    app = await appWith([UpCheck, DownCheck]);
    const res = await request(server(app)).get('/health/ready').expect(503);
    expect((res.body as Body).status).toBe('error');
    expect((res.body as Body).details['down-dep']?.status).toBe('down');
    expect((res.body as Body).details['up-dep']?.status).toBe('up');
  });

  it('a never-resolving check reports down within the timeout', async () => {
    app = await appWith([HungCheck], { timeoutMs: 200 });
    const started = Date.now();
    const res = await request(server(app)).get('/health/ready').expect(503);
    expect(Date.now() - started).toBeLessThan(700);
    expect((res.body as Body).details['hung-dep']?.status).toBe('down');
  });

  it('fails readiness during the drain while liveness stays 200', async () => {
    app = await appWith([UpCheck], { drainMs: 300 });
    await app.listen(0, '127.0.0.1');
    const url = await app.getUrl();
    const started = Date.now();
    const closing = app.close();
    await new Promise((r) => setTimeout(r, 100));
    const ready = await fetch(`${url}/health/ready`);
    const live = await fetch(`${url}/health/live`);
    expect(ready.status).toBe(503);
    const body = (await ready.json()) as {
      status: string;
      details: Record<string, { status: string }>;
    };
    expect(body.status).toBe('error');
    expect(body.details.shutdown?.status).toBe('down');
    expect(live.status).toBe(200);
    await closing;
    expect(Date.now() - started).toBeGreaterThanOrEqual(290);
    app = undefined;
  });
});
