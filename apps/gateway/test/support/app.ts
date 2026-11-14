import { randomBytes } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import type { DestinationStream } from 'pino';
import type { HttpStub } from '@eticket/testing';
import { createApp } from '../../src/main';

export interface RunningGateway {
  baseUrl: string;
  app: INestApplication;
  adminEmail: string;
  adminPassword: string;
  close(): Promise<void>;
}

export const ADMIN_EMAIL = 'admin@example.com';
export const ADMIN_PASSWORD = 'test-admin-password-123';
export const PUBLIC_KEYS = {
  ticket: 'test-gw-ticket-key-0123456789abcdef',
  payment: 'test-gw-payment-key-0123456789abcdef',
  ledger: 'test-gw-ledger-key-0123456789abcdef',
};

let cachedHashB64: string | undefined;

/** bcrypt at cost 12 takes a few hundred ms, so hash once per test run. */
function adminHashB64(): string {
  cachedHashB64 ??= Buffer.from(bcrypt.hashSync(ADMIN_PASSWORD, 12)).toString('base64');
  return cachedHashB64;
}

/** Boots the gateway on a random port against the HTTP stubs. */
export async function startGateway(
  stubs: { ticket: HttpStub; payment: HttpStub; ledger: HttpStub },
  overrides: Record<string, string> = {},
  options: { logStream?: DestinationStream } = {},
): Promise<RunningGateway> {
  const app = await createApp(
    {
      TICKET_SERVICE_URL: stubs.ticket.url,
      PAYMENT_SERVICE_URL: stubs.payment.url,
      LEDGER_SERVICE_URL: stubs.ledger.url,
      PUBLIC_API_KEY_TICKET: PUBLIC_KEYS.ticket,
      PUBLIC_API_KEY_PAYMENT: PUBLIC_KEYS.payment,
      PUBLIC_API_KEY_LEDGER: PUBLIC_KEYS.ledger,
      JWT_SECRET: randomBytes(48).toString('hex'),
      ADMIN_EMAIL,
      ADMIN_PASSWORD_HASH_B64: adminHashB64(),
      WEB_ORIGIN: 'http://localhost:5173',
      RATE_LIMIT_DEFAULT_PER_MIN: '10000',
      RATE_LIMIT_ORDERS_PER_MIN: '10000',
      RATE_LIMIT_LOGIN_PER_MIN: '10000',
      LOG_LEVEL: 'silent',
      ...overrides,
    },
    options,
  );
  await app.listen(0, '127.0.0.1');
  return {
    baseUrl: await app.getUrl(),
    app,
    adminEmail: ADMIN_EMAIL,
    adminPassword: ADMIN_PASSWORD,
    close: () => app.close(),
  };
}
