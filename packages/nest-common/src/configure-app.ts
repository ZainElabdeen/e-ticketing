import type { INestApplication } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { correlationIdMiddleware } from './correlation-id';
import { setupDocs } from './docs';
import { ErrorEnvelopeFilter } from './error-envelope.filter';
import { createValidationPipe } from './validation';

/**
 * The shared app setup: case-sensitive routing, correlation ID, pino logger,
 * error envelope, validation pipe and docs. `contractFile` is an absolute path.
 */
export function configureApp(
  app: INestApplication,
  opts: { swaggerEnabled: boolean; contractFile: string },
): void {
  // Exact-case routing, so /V1/Internal/... cannot reach an internal handler.
  // Express built its router when the app was created, so set the router flag too.
  const express = app.getHttpAdapter().getInstance() as {
    set(key: string, value: boolean): void;
    router: { caseSensitive: boolean };
  };
  express.set('case sensitive routing', true);
  express.router.caseSensitive = true;
  app.use(correlationIdMiddleware);
  app.useLogger(app.get(Logger));
  app.useGlobalFilters(new ErrorEnvelopeFilter());
  app.useGlobalPipes(createValidationPipe());
  setupDocs(app, opts.swaggerEnabled, opts.contractFile);
}
