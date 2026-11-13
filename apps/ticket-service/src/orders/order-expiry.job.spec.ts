import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SchedulerRegistry } from '@nestjs/schedule';
import type { EnvironmentVariables } from '../config/env';
import { OrderExpiryJob } from './order-expiry.job';
import type { OrdersRepository } from './orders.repository';

function makeJob(expireOne: () => Promise<string | null>): OrderExpiryJob {
  const config = { get: () => 10 } as unknown as ConfigService<EnvironmentVariables, true>;
  return new OrderExpiryJob(
    { expireOne } as unknown as OrdersRepository,
    config,
    {} as SchedulerRegistry,
  );
}

describe('OrderExpiryJob shutdown', () => {
  afterEach(() => jest.restoreAllMocks());

  it('beforeApplicationShutdown waits for an in-flight run', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const job = makeJob(async () => {
      calls += 1;
      await gate;
      return null;
    });
    const run = job.runOnce();
    let stopped = false;
    const stopping = job.beforeApplicationShutdown().then(() => (stopped = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(calls).toBe(1);
    expect(stopped).toBe(false);
    release();
    await stopping;
    expect(stopped).toBe(true);
    await expect(run).resolves.toBe(0);
  });

  it('beforeApplicationShutdown resolves at once when idle and survives a failed run', async () => {
    const job = makeJob(() => Promise.reject(new Error('db down')));
    await job.beforeApplicationShutdown();
    const run = job.runOnce();
    await expect(run).rejects.toThrow('db down');
    await expect(job.beforeApplicationShutdown()).resolves.toBeUndefined();
  });

  it('logs the Error object so the stack is kept', async () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const boom = new Error('db down');
    const job = makeJob(() => Promise.reject(boom));
    await (job as unknown as { tick(): Promise<void> }).tick();
    expect(error).toHaveBeenCalledWith(expect.objectContaining({ err: boom }), expect.any(String));
  });
});
