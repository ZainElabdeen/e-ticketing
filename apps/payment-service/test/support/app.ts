import type { INestApplication } from '@nestjs/common';
import type { HttpStub, TestDatabase } from '@eticket/testing';
import { createApp } from '../../src/main';

export interface RunningPaymentService {
  baseUrl: string;
  app: INestApplication;
  publicKey: string;
  close(): Promise<void>;
}

export const PUBLIC_KEY = 'test-public-key-0123456789abcdef-pub';
export const TICKET_KEY = 'test-ticket-key-0123456789abcdef-tkt';
export const LEDGER_KEY = 'test-ledger-key-0123456789abcdef-ldg';

/** Boots the service on a random port against the test database and the HTTP stubs. */
export async function startPaymentService(
  db: TestDatabase,
  stubs: { ticket: HttpStub; ledger: HttpStub },
  overrides: Record<string, string> = {},
): Promise<RunningPaymentService> {
  const app = await createApp({
    DATABASE_URL: db.urlFor('payments_app'),
    PUBLIC_API_KEY_PAYMENT: PUBLIC_KEY,
    TICKET_SERVICE_URL: stubs.ticket.url,
    LEDGER_SERVICE_URL: stubs.ledger.url,
    INTERNAL_API_KEY_TICKET: TICKET_KEY,
    INTERNAL_API_KEY_LEDGER: LEDGER_KEY,
    QR_JOB_ENABLED: 'false',
    OUTBOX_ENABLED: 'false',
    LOG_LEVEL: 'silent',
    ...overrides,
  });
  await app.listen(0, '127.0.0.1');
  return {
    baseUrl: await app.getUrl(),
    app,
    publicKey: PUBLIC_KEY,
    close: () => app.close(),
  };
}
