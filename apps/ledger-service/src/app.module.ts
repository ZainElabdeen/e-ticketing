import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { PrismaService } from './common/prisma.service';
import type { EnvironmentVariables } from './config/env';
import { HealthController } from './health/health.controller';
import { LedgerRepository } from './ledger/ledger.repository';
import { PostingsController } from './ledger/postings.controller';
import { PostingsService } from './ledger/postings.service';

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
            service: 'ledger-service',
            level: config.get('LOG_LEVEL'),
            stream: options.logStream,
          }),
        }),
      }),
      TerminusModule,
      // Keep last: routes register in import order and this one matches everything.
      FallbackModule,
    ],
    controllers: [HealthController, PostingsController],
    providers: [
      PrismaService,
      LedgerRepository,
      PostingsService,
      {
        provide: API_KEYS,
        inject: [ConfigService],
        useFactory: (config: ConfigService<EnvironmentVariables, true>): ApiKeys => ({
          publicKey: config.get('PUBLIC_API_KEY_LEDGER'),
          internalKey: config.get('INTERNAL_API_KEY_LEDGER'),
        }),
      },
      { provide: APP_GUARD, useClass: ApiKeyGuard },
    ],
    exports: [PrismaService],
  })
  class AppModule {}

  return { module: AppModule };
}
