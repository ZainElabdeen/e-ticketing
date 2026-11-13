import { runPaymentServiceContract } from '@eticket/contract-tests';
import {
  applyMigrations,
  startHttpStub,
  startTestDatabase,
  type HttpStub,
  type TestDatabase,
} from '@eticket/testing';
import { startPaymentService, type RunningPaymentService } from './support/app';
import { stubPayableOrder } from './support/stubs';

let db: TestDatabase;
let ticket: HttpStub;
let ledger: HttpStub;
let service: RunningPaymentService;

beforeAll(async () => {
  db = await startTestDatabase();
  applyMigrations(db, 'payment-service');
  ticket = await startHttpStub();
  ledger = await startHttpStub();
  // Any order that was not stubbed as payable does not exist.
  ticket.on('GET', /^\/v1\/orders\//, {
    status: 404,
    body: {
      statusCode: 404,
      code: 'ORDER_NOT_FOUND',
      message: 'order not found',
      correlationId: 'c',
    },
  });
  service = await startPaymentService(
    db,
    { ticket, ledger },
    { QR_SUCCESS_DELAY_SECONDS: '3', QR_JOB_INTERVAL_SECONDS: '1', QR_JOB_ENABLED: 'true' },
  );
});

afterAll(async () => {
  await service?.close();
  await ticket?.close();
  await ledger?.close();
  await db?.stop();
});

runPaymentServiceContract(() => ({
  baseUrl: service.baseUrl,
  publicApiKey: service.publicKey,
  qrDelaySeconds: 3,
  newPayableOrder: () => Promise.resolve(stubPayableOrder(ticket)),
}));
