import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ContractService = 'ticket-service' | 'payment-service' | 'ledger-service' | 'gateway';

/**
 * `openapi.json` next to the dist directory once built; the contracts package's
 * copy in dev and tests (resolved from the app, which depends on it).
 */
export function resolveContractFile(distDir: string, service: ContractService): string {
  const built = join(distDir, '..', 'openapi.json');
  return existsSync(built)
    ? built
    : require.resolve(`@eticket/contracts/openapi/${service}.json`, { paths: [distDir] });
}

/** Builds the app from `process.env`, enables shutdown hooks and listens on 0.0.0.0:PORT. */
export async function bootstrapService(
  createApp: (env: Record<string, string | undefined>) => Promise<INestApplication>,
): Promise<void> {
  const app = await createApp(process.env);
  app.enableShutdownHooks();
  const port = app.get<ConfigService<{ PORT: number }, true>>(ConfigService).get('PORT', {
    infer: true,
  });
  await app.listen(port, '0.0.0.0');
}

/** Runs `fn` only when `module` is the process entry point; a failure is logged and exits 1. */
export function runIfMain(module: NodeModule, fn: () => Promise<void>): void {
  if (require.main === module) {
    fn().catch((err: unknown) => {
      console.error(err);
      process.exit(1);
    });
  }
}
