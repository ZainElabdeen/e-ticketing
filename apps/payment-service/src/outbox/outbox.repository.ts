import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../common/prisma.service';
import type { EnvironmentVariables } from '../config/env';
import type { ConfirmOutcome } from '../downstream/ticket.client';
import { nextAttemptDelaySeconds } from '../payments/domain/backoff';

export interface PaymentSucceededPayload {
  transactionId: string;
  paymentId: string;
  orderId: string;
  paymentReference: string;
  amountMinor: number;
  currency: string;
  occurredAt: string;
  correlationId?: string;
}

export interface ClaimedEvent {
  id: string;
  payload: PaymentSucceededPayload;
  confirmOutcome: ConfirmOutcome | null;
  attempts: number;
}

export type EventUpdate =
  | { kind: 'DONE'; confirmOutcome: ConfirmOutcome }
  | { kind: 'RETRY'; confirmOutcome: ConfirmOutcome | null; error: string };

const MAX_ERROR_LENGTH = 500;
/** Slack on top of the two downstream calls the claiming transaction spans. */
const TX_MARGIN_MS = 5000;

@Injectable()
export class OutboxRepository {
  private readonly logger = new Logger(OutboxRepository.name);
  private readonly maxAttempts: number;
  private readonly txTimeoutMs: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.maxAttempts = config.get('OUTBOX_MAX_ATTEMPTS', { infer: true });
    this.txTimeoutMs = 2 * config.get('DOWNSTREAM_TIMEOUT_MS', { infer: true }) + TX_MARGIN_MS;
  }

  /**
   * Claims one due event, runs the handler inside the claiming transaction
   * (ADR-0006: the two HTTP calls are bounded by DOWNSTREAM_TIMEOUT_MS) and
   * applies its update. False when nothing is due.
   */
  async processOne(handler: (event: ClaimedEvent) => Promise<EventUpdate>): Promise<boolean> {
    let claimed: { id: string; attempts: number } | undefined;
    try {
      return await this.claimAndRun(handler, (c) => (claimed = c));
    } catch (err) {
      // The claiming transaction rolled back (a DB error or its timeout), so the event is
      // unchanged and would be re-claimed forever without ever reaching FAILED. Count the
      // attempt in a separate short statement. Nothing to do if the claim never happened.
      if (claimed) {
        await this.recordFailedAttempt(claimed, err);
      }
      throw err;
    }
  }

  private async recordFailedAttempt(
    claimed: { id: string; attempts: number },
    cause: unknown,
  ): Promise<void> {
    const attempts = claimed.attempts + 1;
    const failed = attempts >= this.maxAttempts;
    const message = cause instanceof Error ? cause.message : String(cause);
    const error = message.slice(0, MAX_ERROR_LENGTH);
    const delay = nextAttemptDelaySeconds(attempts);
    try {
      await this.prisma.$executeRaw`
        UPDATE payments.outbox_events
        SET attempts = attempts + 1,
            last_error = ${error},
            next_attempt_at = now() + make_interval(secs => ${delay}::float8),
            status = CASE WHEN ${failed} THEN 'FAILED' ELSE status END,
            processed_at = CASE WHEN ${failed} THEN now() ELSE processed_at END
        WHERE id = ${claimed.id}::uuid AND status = 'PENDING'`;
    } catch (updateErr) {
      // The original error is the one to surface; the event stays due and is retried.
      this.logger.error({ eventId: claimed.id, err: updateErr }, 'could not record failed attempt');
      return;
    }
    if (failed) {
      this.logger.error({ eventId: claimed.id, attempts }, 'outbox event FAILED');
    }
  }

  private claimAndRun(
    handler: (event: ClaimedEvent) => Promise<EventUpdate>,
    onClaim: (claimed: { id: string; attempts: number }) => void,
  ): Promise<boolean> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            id: string;
            payload: PaymentSucceededPayload;
            confirm_outcome: ConfirmOutcome | null;
            attempts: number;
          }>
        >`SELECT id, payload, confirm_outcome, attempts
          FROM payments.outbox_events
          WHERE status = 'PENDING' AND next_attempt_at <= now()
          ORDER BY created_at
          FOR UPDATE SKIP LOCKED
          LIMIT 1`;
        const row = rows[0];
        if (!row) return false;
        onClaim({ id: row.id, attempts: row.attempts });

        const update = await handler({
          id: row.id,
          payload: row.payload,
          confirmOutcome: row.confirm_outcome,
          attempts: row.attempts,
        });

        if (update.kind === 'DONE') {
          await tx.$executeRaw`
            UPDATE payments.outbox_events
            SET status = 'DONE', confirm_outcome = ${update.confirmOutcome}, processed_at = now()
            WHERE id = ${row.id}::uuid`;
          return true;
        }

        const attempts = row.attempts + 1;
        const failed = attempts >= this.maxAttempts;
        const error = update.error.slice(0, MAX_ERROR_LENGTH);
        const delay = nextAttemptDelaySeconds(attempts);
        await tx.$executeRaw`
          UPDATE payments.outbox_events
          SET attempts = attempts + 1,
              confirm_outcome = COALESCE(${update.confirmOutcome}::text, confirm_outcome),
              last_error = ${error},
              next_attempt_at = now() + make_interval(secs => ${delay}::float8),
              status = CASE WHEN ${failed} THEN 'FAILED' ELSE status END,
              processed_at = CASE WHEN ${failed} THEN now() ELSE processed_at END
          WHERE id = ${row.id}::uuid`;
        if (failed) {
          this.logger.error({ eventId: row.id, attempts }, 'outbox event FAILED');
        } else {
          this.logger.warn({ eventId: row.id, attempts, error }, 'outbox event will be retried');
        }
        return true;
      },
      { timeout: this.txTimeoutMs, maxWait: 5000 },
    );
  }
}
