import { HttpModule } from '@nestjs/axios';
import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import {
  API_KEYS,
  ApiKeyGuard,
  FallbackModule,
  pinoHttpOptions,
  type ApiKeys,
} from '@eticket/nest-common';
import { CLOCK, SystemClock, type Clock } from './common/clock';
import { PrismaService } from './common/prisma.service';
import type { EnvironmentVariables } from './config/env';
import { LedgerClient } from './downstream/ledger.client';
import { TicketClient } from './downstream/ticket.client';
import { HealthController } from './health/health.controller';

/** Test seams: where request logs are written (default: stdout) and the time source. */
export interface AppOptions {
  logStream?: DestinationStream;
  clock?: Clock;
}

/**
 * Builds the root module over an already-validated env, so tests can boot the
 * app with their own values instead of process.env.
 */
export function createAppModule(
  env: EnvironmentVariables,
  options: AppOptions = {},
): DynamicModule {
  @Module({
    imports: [
      ConfigModule.forRoot({
        isGlobal: true,
        ignoreEnvFile: true,
        ignoreEnvVars: true,
        load: [() => ({ ...env })],
      }),
      LoggerModule.forRootAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
          pinoHttp: pinoHttpOptions({
            service: 'payment-service',
            level: config.get('LOG_LEVEL'),
            stream: options.logStream,
          }),
        }),
      }),
      TerminusModule,
      HttpModule.registerAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
          timeout: config.get('DOWNSTREAM_TIMEOUT_MS'),
          // The clients map statuses themselves.
          validateStatus: () => true,
          maxRedirects: 0,
        }),
      }),
      ScheduleModule.forRoot(),
      // Keep last: routes register in import order and this one matches everything.
      FallbackModule,
    ],
    controllers: [HealthController],
    providers: [
      PrismaService,
      TicketClient,
      LedgerClient,
      { provide: CLOCK, useValue: options.clock ?? new SystemClock() },
      {
        provide: API_KEYS,
        inject: [ConfigService],
        // No internal key: this service has no /v1/internal routes.
        useFactory: (config: ConfigService<EnvironmentVariables, true>): ApiKeys => ({
          publicKey: config.get('PUBLIC_API_KEY_PAYMENT'),
        }),
      },
      { provide: APP_GUARD, useClass: ApiKeyGuard },
    ],
    exports: [PrismaService, TicketClient, LedgerClient],
  })
  class AppModule {}

  return { module: AppModule };
}
