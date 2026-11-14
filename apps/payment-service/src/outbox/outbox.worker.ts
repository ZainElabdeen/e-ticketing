import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { EnvironmentVariables } from '../config/env';
import { LedgerClient } from '../downstream/ledger.client';
import { TicketClient, type ConfirmOutcome } from '../downstream/ticket.client';
import { OutboxRepository, type ClaimedEvent, type EventUpdate } from './outbox.repository';

const INTERVAL_NAME = 'outbox';
const CORRELATION_ID = 'job:outbox';
const LEDGER_SKIPPED = 'ledger skipped: unavailable earlier in this batch';

/** Per-run Ledger breaker: trips on the first failed post, so one batch makes at most one bad call. */
interface Breaker {
  open: boolean;
}

/**
 * Delivers payment.succeeded events (spec §4.4): confirm the order first, then
 * post the journal entry. The confirm outcome is stored as soon as it is known,
 * so a retry after a Ledger failure never asks the Ticket Service twice.
 */
@Injectable()
export class OutboxWorker implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(OutboxWorker.name);
  private running = false;
  private inFlight: Promise<number> | undefined;

  constructor(
    private readonly repository: OutboxRepository,
    private readonly ticket: TicketClient,
    private readonly ledger: LedgerClient,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('OUTBOX_ENABLED', { infer: true })) {
      return;
    }
    const seconds = this.config.get('OUTBOX_INTERVAL_SECONDS', { infer: true });
    this.scheduler.addInterval(
      INTERVAL_NAME,
      setInterval(() => void this.tick(), seconds * 1000),
    );
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', INTERVAL_NAME)) {
      this.scheduler.deleteInterval(INTERVAL_NAME);
    }
  }

  /** Lets an in-flight run finish before Nest closes the HTTP server and the DB pool. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.inFlight?.catch(() => undefined);
  }

  /** Processes up to OUTBOX_BATCH_SIZE events, one DB transaction each. Returns how many. */
  runOnce(): Promise<number> {
    const run = this.processBatch();
    this.inFlight = run;
    const clear = (): void => {
      if (this.inFlight === run) {
        this.inFlight = undefined;
      }
    };
    run.then(clear, clear);
    return run;
  }

  private async processBatch(): Promise<number> {
    const batch = this.config.get('OUTBOX_BATCH_SIZE', { infer: true });
    const breaker: Breaker = { open: false };
    let claimed = 0;
    while (claimed < batch) {
      let found: boolean;
      try {
        found = await this.repository.processOne((event) => this.deliver(event, breaker));
      } catch (err) {
        // The transaction rolled back, so the event is still due. Stop here instead of
        // re-claiming it in a tight loop; the next tick retries.
        this.logger.error({ correlationId: CORRELATION_ID, err }, 'outbox event processing failed');
        break;
      }
      if (!found) {
        break;
      }
      claimed += 1;
    }
    return claimed;
  }

  private async deliver(event: ClaimedEvent, breaker: Breaker): Promise<EventUpdate> {
    const { payload } = event;
    const correlationId = payload.correlationId ?? event.id;
    let outcome: ConfirmOutcome | null = event.confirmOutcome;
    try {
      outcome ??= await this.ticket.confirmOrder(
        payload.orderId,
        payload.transactionId,
        correlationId,
      );
      if (breaker.open) {
        // The Ledger already failed in this batch: keep the confirm (stored with the
        // update) but do not wait on another dead call.
        return { kind: 'RETRY', confirmOutcome: outcome, error: LEDGER_SKIPPED };
      }
      await this.postToLedger(payload, outcome, correlationId, breaker);
      return { kind: 'DONE', confirmOutcome: outcome };
    } catch (err) {
      return {
        kind: 'RETRY',
        confirmOutcome: outcome,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  private async postToLedger(
    payload: ClaimedEvent['payload'],
    outcome: ConfirmOutcome,
    correlationId: string,
    breaker: Breaker,
  ): Promise<void> {
    try {
      await this.ledger.post(
        {
          transactionId: payload.transactionId,
          postingType: outcome === 'CONFIRMED' ? 'TICKET_SALE' : 'UNFULFILLED_PAYMENT',
          orderId: payload.orderId,
          paymentReference: payload.paymentReference,
          amountMinor: payload.amountMinor,
          currency: payload.currency,
        },
        correlationId,
      );
    } catch (err) {
      breaker.open = true;
      throw err;
    }
  }

  /** Interval entry point: skips while a run is in progress, never throws. */
  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const claimed = await this.runOnce();
      if (claimed > 0) {
        this.logger.log({ correlationId: CORRELATION_ID, claimed }, 'processed outbox events');
      }
    } catch (err) {
      this.logger.error({ correlationId: CORRELATION_ID, err }, 'outbox run failed');
    } finally {
      this.running = false;
    }
  }
}
