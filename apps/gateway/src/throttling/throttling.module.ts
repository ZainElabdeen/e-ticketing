import { Module, type ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { EnvironmentVariables } from '../config/env';
import { FixedWindowStorage } from './fixed-window.storage';
import { GatewayThrottlerGuard } from './gateway-throttler.guard';
import { RATE_LIMIT_SCOPE, type RateLimitScope } from './rate-limit';

@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => {
        const reflector = new Reflector();
        const scopeOf = (context: ExecutionContext): RateLimitScope | undefined =>
          reflector.getAllAndOverride<RateLimitScope | undefined>(RATE_LIMIT_SCOPE, [
            context.getHandler(),
            context.getClass(),
          ]);
        const limits: Record<RateLimitScope, number> = {
          orders: config.get('RATE_LIMIT_ORDERS_PER_MIN', { infer: true }),
          login: config.get('RATE_LIMIT_LOGIN_PER_MIN', { infer: true }),
        };
        const ttl = config.get('RATE_LIMIT_WINDOW_MS', { infer: true });
        return {
          throttlers: [
            {
              name: 'default',
              ttl,
              limit: config.get('RATE_LIMIT_DEFAULT_PER_MIN', { infer: true }),
            },
            {
              name: 'scoped',
              ttl,
              limit: (context: ExecutionContext) => limits[scopeOf(context) ?? 'orders'],
              skipIf: (context: ExecutionContext) => scopeOf(context) === undefined,
            },
          ],
          storage: new FixedWindowStorage(),
        };
      },
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: GatewayThrottlerGuard }],
})
export class ThrottlingModule {}
