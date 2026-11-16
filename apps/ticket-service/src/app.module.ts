import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import {
  API_KEYS,
  ApiKeyGuard,
  FallbackModule,
  HealthModule,
  pinoHttpOptions,
  prismaReadinessCheck,
  type ApiKeys,
} from '@eticket/nest-common';
import { PrismaModule } from './common/prisma.module';
import { PrismaService } from './common/prisma.service';
import type { EnvironmentVariables } from './config/env';
import { InternalOrdersController } from './orders/internal-orders.controller';
import { OrderExpiryJob } from './orders/order-expiry.job';
import { OrdersController } from './orders/orders.controller';
import { OrdersRepository } from './orders/orders.repository';
import { OrdersService } from './orders/orders.service';
import { TicketTypesController } from './ticket-types/ticket-types.controller';
import { TicketTypesRepository } from './ticket-types/ticket-types.repository';

/** Test seam: where request logs are written (default: stdout). */
export interface AppOptions {
  logStream?: DestinationStream;
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
            service: 'ticket-service',
            level: config.get('LOG_LEVEL'),
            stream: options.logStream,
          }),
        }),
      }),
      PrismaModule,
      HealthModule.forRoot({
        imports: [PrismaModule],
        checks: [prismaReadinessCheck(PrismaService)],
        drainMs: env.SHUTDOWN_DRAIN_MS,
      }),
      ScheduleModule.forRoot(),
      // Keep last: routes register in import order and this one matches everything.
      FallbackModule,
    ],
    controllers: [TicketTypesController, OrdersController, InternalOrdersController],
    providers: [
      TicketTypesRepository,
      OrdersRepository,
      OrdersService,
      OrderExpiryJob,
      {
        provide: API_KEYS,
        inject: [ConfigService],
        useFactory: (config: ConfigService<EnvironmentVariables, true>): ApiKeys => ({
          publicKey: config.get('PUBLIC_API_KEY_TICKET'),
          internalKey: config.get('INTERNAL_API_KEY_TICKET'),
        }),
      },
      { provide: APP_GUARD, useClass: ApiKeyGuard },
    ],
  })
  class AppModule {}

  return { module: AppModule };
}
