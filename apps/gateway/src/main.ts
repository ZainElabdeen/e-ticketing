import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { configureApp } from '@eticket/nest-common';
import { createAppModule, type AppOptions } from './app.module';
import { validateEnv, type EnvironmentVariables } from './config/env';

/** `dist/openapi.json` once built; the contracts package's copy in dev and tests. */
function contractFile(): string {
  const built = join(__dirname, '..', 'openapi.json');
  return existsSync(built) ? built : require.resolve('@eticket/contracts/openapi/gateway.json');
}

/** Builds the fully configured app without listening. Used by `bootstrap` and tests. */
export async function createApp(
  env: Record<string, string | undefined>,
  options: AppOptions = {},
): Promise<INestApplication> {
  const validated = validateEnv(env);
  const app = await NestFactory.create<NestExpressApplication>(
    createAppModule(validated, options),
    { bufferLogs: true },
  );
  // Hops of trusted proxies in front of the gateway; decides which IP counts as the client.
  app.set('trust proxy', validated.TRUST_PROXY);
  app.use(helmet());
  // Tokens and admin data must never sit in a browser or proxy cache, errors included.
  app.use(
    ['/v1/backoffice', '/v1/auth'],
    (_req: unknown, res: { setHeader(name: string, value: string): unknown }, next: () => void) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  app.enableCors({
    // An array makes cors echo the request origin only when it matches.
    origin: [new URL(validated.WEB_ORIGIN).origin],
    credentials: false,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-Id'],
    exposedHeaders: ['X-Correlation-Id', 'Idempotent-Replayed', 'Retry-After'],
  });
  configureApp(app, { swaggerEnabled: validated.SWAGGER_ENABLED, contractFile: contractFile() });
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
