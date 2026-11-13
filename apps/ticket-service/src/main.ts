import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { createAppModule } from './app.module';
import { validateEnv, type EnvironmentVariables } from './config/env';

/** Builds the fully configured app without listening. Used by `bootstrap` and tests. */
export async function createApp(
  env: Record<string, string | undefined>,
): Promise<INestApplication> {
  const validated = validateEnv(env);
  const app = await NestFactory.create(createAppModule(validated), { bufferLogs: true });
  app.useLogger(app.get(Logger));
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
