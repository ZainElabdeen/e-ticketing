import { Module, type DynamicModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
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
import { AccountsController } from './ledger/accounts.controller';
import { JournalEntriesController } from './ledger/journal-entries.controller';
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
      PrismaModule,
      HealthModule.forRoot({
        imports: [PrismaModule],
        checks: [prismaReadinessCheck(PrismaService)],
        drainMs: env.SHUTDOWN_DRAIN_MS,
      }),
      // Keep last: routes register in import order and this one matches everything.
      FallbackModule,
    ],
    controllers: [PostingsController, JournalEntriesController, AccountsController],
    providers: [
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
  })
  class AppModule {}

  return { module: AppModule };
}
