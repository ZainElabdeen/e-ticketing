import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { setupDocs } from './common/docs';
import { ErrorEnvelopeFilter } from './common/http/error-envelope.filter';
import { correlationIdMiddleware } from './common/http/correlation-id';
import { createValidationPipe } from './common/http/validation';
import { createAppModule } from './app.module';
import { validateEnv, type EnvironmentVariables } from './config/env';

/** Builds the fully configured app without listening. Used by `bootstrap` and tests. */
export async function createApp(
  env: Record<string, string | undefined>,
): Promise<INestApplication> {
  const validated = validateEnv(env);
  const app = await NestFactory.create(createAppModule(validated), { bufferLogs: true });
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.useGlobalPipes(createValidationPipe());
  setupDocs(app, validated.SWAGGER_ENABLED);
  return app;
}

async function bootstrap(): Promise<void> {
  const app = await createApp(process.env);
  app.enableShutdownHooks();
  const port = app
    .get<ConfigService<EnvironmentVariables, true>>(ConfigService)
    .get('PORT', { infer: true });
  await app.listen(port, '0.0.0.0');
}

if (require.main === module) {
  bootstrap().catch((err: unknown) => {
    console.error(err);
    process.exit(1);
  });
}
