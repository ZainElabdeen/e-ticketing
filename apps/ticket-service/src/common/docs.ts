import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/** `dist/openapi.json` once built; the contracts package's copy in dev and tests. */
function loadContract(): OpenAPIObject {
  const built = join(__dirname, '..', '..', 'openapi.json');
  const path = existsSync(built)
    ? built
    : require.resolve('@eticket/contracts/openapi/ticket-service.json');
  return JSON.parse(readFileSync(path, 'utf8')) as OpenAPIObject;
}

/**
 * Serves the contract at /docs. Swagger registers plain Express routes, which
 * the API-key guard never sees, so the docs need no key.
 */
export function setupDocs(app: INestApplication, enabled: boolean): void {
  if (enabled) {
    SwaggerModule.setup('docs', app, loadContract());
  }
}
