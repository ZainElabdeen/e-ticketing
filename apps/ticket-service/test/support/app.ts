import type { INestApplication } from '@nestjs/common';
import type { DestinationStream } from 'pino';
import type { TestDatabase } from '@eticket/testing';
import { createApp } from '../../src/main';

export interface RunningService {
  baseUrl: string;
  app: INestApplication;
  publicKey: string;
  internalKey: string;
  close(): Promise<void>;
}

const PUBLIC_KEY = 'test-public-key-0123456789abcdef-pub';
const INTERNAL_KEY = 'test-internal-key-0123456789abcdef-int';

/** Boots the service on a random port against the test database. */
export async function startTicketService(
  db: TestDatabase,
  overrides: Record<string, string> = {},
  options: { logStream?: DestinationStream } = {},
): Promise<RunningService> {
  const app = await createApp(
    {
      DATABASE_URL: db.urlFor('tickets_app'),
      PUBLIC_API_KEY_TICKET: PUBLIC_KEY,
      INTERNAL_API_KEY_TICKET: INTERNAL_KEY,
      ORDER_EXPIRY_ENABLED: 'false',
      LOG_LEVEL: 'silent',
      ...overrides,
    },
    options,
  );
  await app.listen(0, '127.0.0.1');
  return {
    baseUrl: await app.getUrl(),
    app,
    publicKey: PUBLIC_KEY,
    internalKey: INTERNAL_KEY,
    close: () => app.close(),
  };
}
