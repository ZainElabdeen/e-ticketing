import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule } from '@nestjs/throttler';
import type { EnvironmentVariables } from '../config/env';
import { GatewayThrottlerGuard } from './gateway-throttler.guard';
import { RATE_LIMIT_WINDOW_MS } from './rate-limit';

/** In-memory counters: correct for the single gateway replica (spec §10). */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
        throttlers: [
          {
            name: 'default',
            ttl: RATE_LIMIT_WINDOW_MS,
            limit: config.get('RATE_LIMIT_DEFAULT_PER_MIN', { infer: true }),
          },
        ],
      }),
    }),
  ],
  providers: [{ provide: APP_GUARD, useClass: GatewayThrottlerGuard }],
})
export class ThrottlingModule {}
