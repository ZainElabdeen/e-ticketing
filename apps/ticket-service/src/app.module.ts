import { randomUUID } from 'node:crypto';
import { Module, type DynamicModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TerminusModule } from '@nestjs/terminus';
import { LoggerModule } from 'nestjs-pino';
import { PrismaService } from './common/prisma.service';
import type { EnvironmentVariables } from './config/env';
import { HealthController } from './health/health.controller';

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
            // Task 3 replaces this with the correlation ID from the middleware.
            genReqId: () => randomUUID(),
            customProps: () => ({ service: 'ticket-service' }),
            redact: ['req.headers["x-api-key"]', 'req.headers.authorization'],
          },
        }),
      }),
      TerminusModule,
    ],
    controllers: [HealthController],
    providers: [PrismaService],
    exports: [PrismaService],
  })
  class AppModule {}

  return { module: AppModule };
}
