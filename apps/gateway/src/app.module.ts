import { HttpModule } from '@nestjs/axios';
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import type { DestinationStream } from 'pino';
import { FallbackModule, pinoHttpOptions } from '@eticket/nest-common';
import type { EnvironmentVariables } from './config/env';
import { DownstreamClient } from './downstream/downstream.client';
import { HealthController } from './health/health.controller';
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
      TerminusModule,
      HttpModule.registerAsync({
        inject: [ConfigService],
        useFactory: (config: ConfigService<EnvironmentVariables, true>) => ({
          timeout: config.get('DOWNSTREAM_TIMEOUT_MS'),
          validateStatus: () => true,
          maxRedirects: 0,
        }),
      }),
      // Keep last: routes register in import order and this one matches everything.
      FallbackModule,
    ],
    controllers: [HealthController, TicketTypesController, OrdersController, PaymentsController],
    providers: [DownstreamClient],
  })
  class AppModule {}

  return { module: AppModule };
}
