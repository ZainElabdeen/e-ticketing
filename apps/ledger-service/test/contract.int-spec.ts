import { runLedgerServiceContract } from '@eticket/contract-tests';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { startLedgerService, type RunningLedgerService } from './support/app';

let db: TestDatabase;
let service: RunningLedgerService;

beforeAll(async () => {
  db = await startTestDatabase();
  applyMigrations(db, 'ledger-service');
  service = await startLedgerService(db);
});

afterAll(async () => {
  await service?.close();
  await db?.stop();
});

runLedgerServiceContract(() => ({
  baseUrl: service.baseUrl,
  publicApiKey: service.publicKey,
  internalApiKey: service.internalKey,
}));
