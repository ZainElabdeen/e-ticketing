import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { ApiKeyGuard } from './common/http/api-key.guard';
import { FallbackModule } from './common/http/fallback.controller';
import { correlationIdOf, type CorrelatedRequest } from './common/http/correlation-id';
import { PrismaService } from './common/prisma.service';
import type { EnvironmentVariables } from './config/env';
import { HealthController } from './health/health.controller';
import { InternalOrdersController } from './orders/internal-orders.controller';
import { OrderExpiryJob } from './orders/order-expiry.job';
import { OrdersController } from './orders/orders.controller';
import { OrdersRepository } from './orders/orders.repository';
import { OrdersService } from './orders/orders.service';
import { TicketTypesController } from './ticket-types/ticket-types.controller';
import { TicketTypesRepository } from './ticket-types/ticket-types.repository';

/**
 * Builds the root module over an already-validated env, so tests can boot the
 * app with their own values instead of process.env.
 */
export function createAppModule(env: EnvironmentVariables): DynamicModule {
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
          pinoHttp: {
            level: config.get('LOG_LEVEL'),
            // correlationIdOf caches per request, so the middleware, the logs and
            // the error body all carry one id whatever the middleware order.
            genReqId: (req: unknown) => correlationIdOf(req as CorrelatedRequest),
            customProps: (req: unknown) => ({
              service: 'ticket-service',
              correlationId: correlationIdOf(req as CorrelatedRequest),
            }),
            redact: ['req.headers["x-api-key"]', 'req.headers.authorization'],
          },
        }),
      }),
      TerminusModule,
      ScheduleModule.forRoot(),
      // Keep last: routes register in import order and this one matches everything.
      FallbackModule,
    ],
    controllers: [
      HealthController,
      TicketTypesController,
      OrdersController,
      InternalOrdersController,
    ],
    providers: [
      PrismaService,
      TicketTypesRepository,
      OrdersRepository,
      OrdersService,
      OrderExpiryJob,
      { provide: APP_GUARD, useClass: ApiKeyGuard },
    ],
    exports: [PrismaService],
  })
  class AppModule {}

  return { module: AppModule };
}
