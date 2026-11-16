import type { ExecutionContext } from '@nestjs/common';
import { GatewayThrottlerGuard } from './gateway-throttler.guard';

const contextFor = (path: string): ExecutionContext =>
  ({
    switchToHttp: () => ({ getRequest: () => ({ path, originalUrl: path }) }),
  }) as unknown as ExecutionContext;

describe('GatewayThrottlerGuard.shouldSkip', () => {
  const guard = Object.create(GatewayThrottlerGuard.prototype) as GatewayThrottlerGuard & {
    shouldSkip(context: ExecutionContext): Promise<boolean>;
  };

  it.each(['/health/live', '/health/ready'])('skips %s', async (path) => {
    await expect(guard.shouldSkip(contextFor(path))).resolves.toBe(true);
  });

  it.each(['/v1/orders', '/v1/ticket-types', '/healthz', '/v1/health/live', '/Health/live'])(
    'does not skip %s',
    async (path) => {
      await expect(guard.shouldSkip(contextFor(path))).resolves.toBe(false);
    },
  );
});
