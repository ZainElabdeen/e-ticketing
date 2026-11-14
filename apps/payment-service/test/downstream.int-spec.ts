import { randomUUID } from 'node:crypto';
import { ContractValidator } from '@eticket/contract-tests';
import { startHttpStub, type HttpStub, type TestDatabase } from '@eticket/testing';
import { LedgerClient, type PostingRequest } from '../src/downstream/ledger.client';
import { TicketClient } from '../src/downstream/ticket.client';
import { UpstreamTimeoutError, UpstreamUnavailableError } from '../src/downstream/upstream-errors';
import {
  LEDGER_KEY,
  TICKET_KEY,
  startPaymentService,
  type RunningPaymentService,
} from './support/app';
import { stubPayableOrder } from './support/stubs';

// The DB connects lazily and these tests never query it.
const fakeDb = {
  urlFor: () => 'postgresql://payments_app:test-password@127.0.0.1:1/eticketing?schema=payments',
} as unknown as TestDatabase;

const ticketContract = ContractValidator.load('ticket-service');
const ledgerContract = ContractValidator.load('ledger-service');
const CID = 'corr-1234';

function errorBody(code: string, statusCode: number): object {
  return { statusCode, code, message: 'x', correlationId: CID };
}

describe('downstream clients', () => {
  let ticket: HttpStub;
  let ledger: HttpStub;
  let svc: RunningPaymentService;
  let tickets: TicketClient;
  let ledgers: LedgerClient;

  /** Registers a ticket reply after checking it against the contract. */
  function ticketReply(
    method: string,
    pattern: RegExp,
    operationId: string,
    status: number,
    body: unknown,
  ): void {
    ticketContract.assertResponse(operationId, status, body);
    ticket.on(method, pattern, { status, body });
  }

  function orderBody(id: string, status = 'PENDING'): Record<string, unknown> {
    return {
      id,
      status,
      items: [
        { ticketTypeCode: 'GOLD', quantity: 1, unitPriceMinor: 70000, lineTotalMinor: 70000 },
      ],
      totalMinor: 70000,
      currency: 'AED',
      createdAt: '2026-11-14T10:00:00.000Z',
      expiresAt: '2026-11-14T10:15:00.000Z',
      confirmedAt: null,
      paidTransactionId: null,
    };
  }

  const posting: PostingRequest = {
    transactionId: randomUUID(),
    postingType: 'TICKET_SALE',
    orderId: randomUUID(),
    paymentReference: 'PAY-20261114-ABCDEF',
    amountMinor: 70000,
    currency: 'AED',
  };

  function journalEntry(): Record<string, unknown> {
    return {
      id: randomUUID(),
      ...posting,
      description: 'Ticket sale',
      correlationId: CID,
      postedAt: '2026-11-14T10:00:00.000Z',
      lines: [
        {
          id: randomUUID(),
          accountCode: '1100',
          accountName: 'Payment Gateway Clearing',
          direction: 'DEBIT',
          amountMinor: 70000,
        },
        {
          id: randomUUID(),
          accountCode: '4000',
          accountName: 'Ticket Sales Revenue',
          direction: 'CREDIT',
          amountMinor: 70000,
        },
      ],
    };
  }

  beforeAll(async () => {
    ticket = await startHttpStub();
    ledger = await startHttpStub();
    svc = await startPaymentService(fakeDb, { ticket, ledger }, { DOWNSTREAM_TIMEOUT_MS: '300' });
    tickets = svc.app.get(TicketClient);
    ledgers = svc.app.get(LedgerClient);
  });

  afterAll(async () => {
    await svc?.close();
    await ticket?.close();
    await ledger?.close();
  });

  beforeEach(() => {
    ticket.reset();
    ledger.reset();
  });

  describe('TicketClient.getOrder', () => {
    it('returns the typed order on 200', async () => {
      const id = randomUUID();
      ticketReply('GET', /^\/v1\/orders\//, 'getOrder', 200, orderBody(id));
      await expect(tickets.getOrder(id, CID)).resolves.toMatchObject({
        id,
        status: 'PENDING',
        totalMinor: 70000,
        currency: 'AED',
        expiresAt: '2026-11-14T10:15:00.000Z',
      });
    });

    it('returns null on 404', async () => {
      ticketReply('GET', /^\/v1\/orders\//, 'getOrder', 404, errorBody('NOT_FOUND', 404));
      await expect(tickets.getOrder(randomUUID(), CID)).resolves.toBeNull();
    });

    it('works against the shared stub helper', async () => {
      const { id } = stubPayableOrder(ticket);
      await expect(tickets.getOrder(id, CID)).resolves.toMatchObject({ id });
    });

    it('maps 500 to UpstreamUnavailableError naming the downstream and status only', async () => {
      ticket.on('GET', /^\/v1\/orders\//, { status: 500, body: { secret: 'leaky-body' } });
      const err = await tickets.getOrder(randomUUID(), CID).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UpstreamUnavailableError);
      const message = (err as Error).message;
      expect(message).toContain('ticket-service');
      expect(message).toContain('500');
      expect(message).not.toContain('leaky-body');
      expect(message).not.toContain(TICKET_KEY);
    });

    it('maps a dropped connection to UpstreamUnavailableError', async () => {
      ticket.on('GET', /^\/v1\/orders\//, 'drop');
      await expect(tickets.getOrder(randomUUID(), CID)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('maps a refused connection to UpstreamUnavailableError', async () => {
      const dead = await startHttpStub();
      const url = dead.url;
      await dead.close();
      const app = await startPaymentService(fakeDb, { ticket: { ...ticket, url }, ledger });
      try {
        await expect(app.app.get(TicketClient).getOrder(randomUUID(), CID)).rejects.toBeInstanceOf(
          UpstreamUnavailableError,
        );
      } finally {
        await app.close();
      }
    });

    it('maps a slow reply to UpstreamTimeoutError', async () => {
      ticket.on('GET', /^\/v1\/orders\//, { status: 200, body: {}, delayMs: 1500 });
      await expect(tickets.getOrder(randomUUID(), CID)).rejects.toBeInstanceOf(
        UpstreamTimeoutError,
      );
    });

    it('does not follow redirects', async () => {
      ticket.on('GET', /^\/v1\/orders\//, { status: 302 });
      await expect(tickets.getOrder(randomUUID(), CID)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('sends the ticket key, the correlation id and JSON content type', async () => {
      const id = randomUUID();
      ticketReply('GET', /^\/v1\/orders\//, 'getOrder', 200, orderBody(id));
      await tickets.getOrder(id, CID);
      const headers = ticket.calls[0]?.headers;
      expect(headers?.['x-api-key']).toBe(TICKET_KEY);
      expect(headers?.['x-correlation-id']).toBe(CID);
    });
  });

  describe('TicketClient.confirmOrder', () => {
    const txId = randomUUID();

    it('returns CONFIRMED on 200 and sends the transaction id', async () => {
      const id = randomUUID();
      ticketReply('POST', /confirm$/, 'confirmOrder', 200, orderBody(id, 'CONFIRMED'));
      await expect(tickets.confirmOrder(id, txId, CID)).resolves.toBe('CONFIRMED');
      expect(ticket.calls[0]?.path).toBe(`/v1/internal/orders/${id}/confirm`);
      expect(ticket.calls[0]?.body).toEqual({ transactionId: txId });
      expect(ticket.calls[0]?.headers['x-api-key']).toBe(TICKET_KEY);
      expect(ticket.calls[0]?.headers['x-correlation-id']).toBe(CID);
    });

    it('returns NOT_CONFIRMABLE on 409 ORDER_NOT_CONFIRMABLE', async () => {
      ticketReply('POST', /confirm$/, 'confirmOrder', 409, errorBody('ORDER_NOT_CONFIRMABLE', 409));
      await expect(tickets.confirmOrder(randomUUID(), txId, CID)).resolves.toBe('NOT_CONFIRMABLE');
    });

    it('treats 409 with another code as transient', async () => {
      ticketReply('POST', /confirm$/, 'confirmOrder', 409, errorBody('SOMETHING_ELSE', 409));
      await expect(tickets.confirmOrder(randomUUID(), txId, CID)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('treats 409 with an unreadable body as transient', async () => {
      ticket.on('POST', /confirm$/, { status: 409 });
      await expect(tickets.confirmOrder(randomUUID(), txId, CID)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('treats 404 as transient', async () => {
      ticketReply('POST', /confirm$/, 'confirmOrder', 404, errorBody('NOT_FOUND', 404));
      await expect(tickets.confirmOrder(randomUUID(), txId, CID)).rejects.toBeInstanceOf(
        UpstreamUnavailableError,
      );
    });

    it('maps a slow reply to UpstreamTimeoutError', async () => {
      ticket.on('POST', /confirm$/, { status: 200, body: {}, delayMs: 1500 });
      await expect(tickets.confirmOrder(randomUUID(), txId, CID)).rejects.toBeInstanceOf(
        UpstreamTimeoutError,
      );
    });
  });

  describe('LedgerClient.post', () => {
    function ledgerReply(status: number, body: unknown): void {
      ledgerContract.assertResponse('createPosting', status, body);
      ledger.on('POST', /^\/v1\/internal\/postings$/, { status, body });
    }

    it.each([201, 200])('resolves on %i', async (status) => {
      ledgerReply(status, journalEntry());
      await expect(ledgers.post(posting, CID)).resolves.toBeUndefined();
    });

    it('sends a contract-valid body with the ledger key and correlation id', async () => {
      ledgerReply(201, journalEntry());
      await ledgers.post(posting, CID);
      const call = ledger.calls[0];
      expect(call?.body).toEqual(posting);
      expect(() => ledgerContract.validateSchema('PostingRequest', call?.body)).not.toThrow();
      expect(call?.headers['x-api-key']).toBe(LEDGER_KEY);
      expect(call?.headers['x-correlation-id']).toBe(CID);
      expect(call?.headers['content-type']).toContain('application/json');
    });

    it('treats 409 POSTING_CONFLICT as transient', async () => {
      ledgerReply(409, errorBody('POSTING_CONFLICT', 409));
      await expect(ledgers.post(posting, CID)).rejects.toBeInstanceOf(UpstreamUnavailableError);
    });

    it('treats 500 as transient and keeps the key out of the message', async () => {
      ledger.on('POST', /postings$/, { status: 500, body: {} });
      const err = await ledgers.post(posting, CID).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UpstreamUnavailableError);
      expect((err as Error).message).toContain('ledger-service');
      expect((err as Error).message).not.toContain(LEDGER_KEY);
    });

    it('maps a slow reply to UpstreamTimeoutError', async () => {
      ledger.on('POST', /postings$/, { status: 201, body: {}, delayMs: 1500 });
      await expect(ledgers.post(posting, CID)).rejects.toBeInstanceOf(UpstreamTimeoutError);
    });
  });
});
