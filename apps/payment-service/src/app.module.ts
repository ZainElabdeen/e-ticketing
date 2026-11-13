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
import { OutboxRepository } from './outbox/outbox.repository';
import { OutboxWorker } from './outbox/outbox.worker';
import { HealthController } from './health/health.controller';
import { CardHandler } from './payments/handlers/card.handler';
import { HandlerRegistry } from './payments/handlers/handler-registry';
import { PAYMENT_HANDLERS, type PaymentHandler } from './payments/handlers/payment-handler';
import { QrHandler } from './payments/handlers/qr.handler';
import { PaymentsController } from './payments/payments.controller';
import { PaymentsRepository } from './payments/payments.repository';
import { PaymentsService } from './payments/payments.service';
import { QrSuccessJob } from './payments/qr-success.job';

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
    controllers: [HealthController, PaymentsController],
    providers: [
      PrismaService,
      TicketClient,
      LedgerClient,
      PaymentsRepository,
      PaymentsService,
      QrSuccessJob,
      OutboxRepository,
      OutboxWorker,
      {
        provide: PAYMENT_HANDLERS,
        inject: [ConfigService],
        useFactory: (config: ConfigService<EnvironmentVariables, true>): PaymentHandler[] => [
          new CardHandler(),
          new QrHandler(config.get('QR_SUCCESS_DELAY_SECONDS')),
        ],
      },
      {
        provide: HandlerRegistry,
        inject: [PAYMENT_HANDLERS],
        useFactory: (handlers: PaymentHandler[]) => new HandlerRegistry(handlers),
      },
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
