import type { Server } from 'node:http';
import { Inject, Injectable, type INestApplication, Module, type Type } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { HealthModule } from './health.module';
import { prismaReadinessCheck } from './prisma-readiness';
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
class StatusCheck implements ReadinessCheck {
  readonly name = 'status-dep';
  check(): Promise<void> {
    return Promise.reject(new Error('status 503'));
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
  checks: Type<ReadinessCheck>[],
  opts: Partial<Parameters<typeof HealthModule.forRoot>[0]> = {},
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

@Injectable()
class FakePrisma {
  fail = false;
  $queryRawUnsafe(): Promise<unknown> {
    return this.fail ? Promise.reject(new Error('db down')) : Promise.resolve([{ '?column?': 1 }]);
  }
}

@Module({ providers: [FakePrisma], exports: [FakePrisma] })
class FakeDbModule {}

const DEP = Symbol('DEP');
@Module({ providers: [{ provide: DEP, useValue: 'dep-value' }], exports: [DEP] })
class DepModule {}

@Injectable()
class InjectingCheck implements ReadinessCheck {
  readonly name = 'injecting';
  constructor(@Inject(DEP) private readonly dep: string) {}
  check(): Promise<void> {
    return this.dep === 'dep-value' ? Promise.resolve() : Promise.reject(new Error('bad'));
  }
}

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

  it('passes a bare "status NNN" rejection through and hides other text', async () => {
    app = await appWith([StatusCheck, DownCheck]);
    const res = await request(server(app)).get('/health/ready').expect(503);
    const d = (res.body as { details: Record<string, { message?: string }> }).details;
    expect(d['status-dep']?.message).toBe('status 503');
    expect(d['down-dep']?.message).toBe('unavailable');
  });

  it('a never-resolving check reports down within the timeout', async () => {
    app = await appWith([HungCheck], { timeoutMs: 200 });
    const started = Date.now();
    const res = await request(server(app)).get('/health/ready').expect(503);
    expect(Date.now() - started).toBeLessThan(2000);
    expect((res.body as Body).details['hung-dep']?.status).toBe('down');
  });

  it('fails readiness during the drain while liveness stays 200', async () => {
    app = await appWith([UpCheck], { drainMs: 1500 });
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
    expect(Date.now() - started).toBeGreaterThanOrEqual(1450);
    app = undefined;
  });

  it('prismaReadinessCheck resolves the client from an imported module', async () => {
    app = await appWith([prismaReadinessCheck(FakePrisma)], { imports: [FakeDbModule] });
    const res = await request(server(app)).get('/health/ready').expect(200);
    expect((res.body as Body).details['database']?.status).toBe('up');
  });

  it('prismaReadinessCheck reports database down when the query rejects', async () => {
    app = await appWith([prismaReadinessCheck(FakePrisma)], { imports: [FakeDbModule] });
    app.get(FakePrisma, { strict: false }).fail = true;
    const res = await request(server(app)).get('/health/ready').expect(503);
    expect((res.body as Body).details['database']?.status).toBe('down');
  });

  it('a check can inject providers exported by an imported module', async () => {
    app = await appWith([InjectingCheck], { imports: [DepModule] });
    const res = await request(server(app)).get('/health/ready').expect(200);
    expect((res.body as Body).details['injecting']?.status).toBe('up');
  });
});
