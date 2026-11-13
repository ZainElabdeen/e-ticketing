import { runTicketServiceContract } from '@eticket/contract-tests';
import { applyMigrations, startTestDatabase, type TestDatabase } from '@eticket/testing';
import { startTicketService, type RunningService } from './support/app';

let db: TestDatabase;
let service: RunningService;

beforeAll(async () => {
  db = await startTestDatabase();
  applyMigrations(db, 'ticket-service');
  service = await startTicketService(db);
});

afterAll(async () => {
  await service?.close();
  await db?.stop();
});

runTicketServiceContract(() => ({
  baseUrl: service.baseUrl,
  publicApiKey: service.publicKey,
  internalApiKey: service.internalKey,
}));
