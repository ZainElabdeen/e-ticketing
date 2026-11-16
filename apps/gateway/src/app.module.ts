import { HttpModule } from '@nestjs/axios';
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { FallbackModule, HealthModule, pinoHttpOptions } from '@eticket/nest-common';
import type { EnvironmentVariables } from './config/env';
import { AuthModule } from './auth/auth.module';
import { BackofficeSummaryService } from './backoffice/backoffice-summary.service';
import { BackofficeController } from './backoffice/backoffice.controller';
import { DownstreamClient } from './downstream/downstream.client';
import { DOWNSTREAM_LIVE_CHECKS } from './health/downstream-live.check';
import { ThrottlingModule } from './throttling/throttling.module';
import { OrdersController } from './shop/orders.controller';
import { PaymentsController } from './shop/payments.controller';
import { TicketTypesController } from './shop/ticket-types.controller';

/** Test seam: where request logs are written (default: stdout). */
export interface AppOptions {
  logStream?: DestinationStream;
}

/**
 * Builds the root module over an already-validated env, so tests can boot the
 * app with their own values instead of process.env. The gateway is the public
 * edge: it registers no ApiKeyGuard.
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
            service: 'gateway',
            level: config.get('LOG_LEVEL'),
            stream: options.logStream,
            extraRedact: ['req.body.password'],
          }),
        }),
      }),
      HealthModule.forRoot({
        imports: [HttpModule],
        checks: DOWNSTREAM_LIVE_CHECKS,
        drainMs: env.SHUTDOWN_DRAIN_MS,
      }),
      AuthModule,
      ThrottlingModule,
      // Timeout, status and redirect handling are set per call (DownstreamClient, the downstream health checks).
      HttpModule,
      // Keep last: routes register in import order and this one matches everything.
      FallbackModule,
    ],
    controllers: [
      TicketTypesController,
      OrdersController,
      PaymentsController,
      BackofficeController,
    ],
    providers: [DownstreamClient, BackofficeSummaryService],
  })
  class AppModule {}

  return { module: AppModule };
}
