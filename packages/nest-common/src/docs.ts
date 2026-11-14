import { readFileSync } from 'node:fs';
import type { INestApplication } from '@nestjs/common';
import { SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';

/**
 * Serves the contract at /docs. Swagger registers plain Express routes, which
 * the API-key guard never sees, so the docs need no key. `contractFile` is an
 * absolute path to the service's OpenAPI JSON.
 */
export function setupDocs(app: INestApplication, enabled: boolean, contractFile: string): void {
  if (enabled) {
    SwaggerModule.setup(
      'docs',
      app,
      JSON.parse(readFileSync(contractFile, 'utf8')) as OpenAPIObject,
    );
  }
}
