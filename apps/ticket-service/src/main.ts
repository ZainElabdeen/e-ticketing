import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  bootstrapService,
  configureApp,
  resolveContractFile,
  runIfMain,
} from '@eticket/nest-common';
import { createAppModule, type AppOptions } from './app.module';
import { validateEnv } from './config/env';

/** Builds the fully configured app without listening. Used by `bootstrap` and tests. */
export async function createApp(
  env: Record<string, string | undefined>,
  options: AppOptions = {},
): Promise<INestApplication> {
  const validated = validateEnv(env);
  const app = await NestFactory.create(createAppModule(validated, options), { bufferLogs: true });
  configureApp(app, {
    swaggerEnabled: validated.SWAGGER_ENABLED,
    contractFile: resolveContractFile(__dirname, 'ticket-service'),
  });
  return app;
}

runIfMain(module, () => bootstrapService(createApp));
