import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env';
import {
  callDownstream,
  downstreamTimeoutMs,
  errorCodeOf,
  unexpectedStatus,
} from './downstream-http';
import { UpstreamUnavailableError } from './upstream-errors';

export interface TicketOrder {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED';
  totalMinor: number;
  currency: string;
  expiresAt: string;
}

export type ConfirmOutcome = 'CONFIRMED' | 'NOT_CONFIRMABLE';

const NAME = 'ticket-service';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STATUSES = new Set(['PENDING', 'CONFIRMED', 'EXPIRED']);

/** A 200 body is trusted for money and expiry, so a malformed one fails closed. */
function parseOrder(data: unknown): TicketOrder {
  const o = (data ?? {}) as Partial<Record<keyof TicketOrder, unknown>>;
  if (
    typeof o.id === 'string' &&
    UUID.test(o.id) &&
    typeof o.status === 'string' &&
    STATUSES.has(o.status) &&
    typeof o.totalMinor === 'number' &&
    Number.isSafeInteger(o.totalMinor) &&
    o.totalMinor > 0 &&
    typeof o.currency === 'string' &&
    /^[A-Z]{3}$/.test(o.currency) &&
    typeof o.expiresAt === 'string' &&
    Number.isFinite(Date.parse(o.expiresAt))
  ) {
    return {
      id: o.id,
      status: o.status as TicketOrder['status'],
      totalMinor: o.totalMinor,
      currency: o.currency,
      expiresAt: o.expiresAt,
    };
  }
  throw new UpstreamUnavailableError(`${NAME} returned a malformed order`);
}

@Injectable()
export class TicketClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;

  constructor(
    private readonly http: HttpService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.baseUrl = config.get<string>('TICKET_SERVICE_URL').replace(/\/+$/, '');
    this.apiKey = config.get<string>('INTERNAL_API_KEY_TICKET');
    this.timeoutMs = downstreamTimeoutMs(config);
  }

  /** The order, or null when the Ticket Service has no such order (404). */
  async getOrder(orderId: string, correlationId: string): Promise<TicketOrder | null> {
    const res = await callDownstream(this.http, NAME, {
      method: 'GET',
      url: `${this.baseUrl}/v1/orders/${encodeURIComponent(orderId)}`,
      apiKey: this.apiKey,
      correlationId,
      timeoutMs: this.timeoutMs,
    });
    if (res.status === 404) {
      return null;
    }
    if (res.status !== 200) {
      throw unexpectedStatus(NAME, res.status);
    }
    return parseOrder(res.data);
  }

  /**
   * 200 confirms; 409 ORDER_NOT_CONFIRMABLE is a terminal business answer.
   * Every other outcome throws, so the outbox retries it.
   */
  async confirmOrder(
    orderId: string,
    transactionId: string,
    correlationId: string,
  ): Promise<ConfirmOutcome> {
    const res = await callDownstream(this.http, NAME, {
      method: 'POST',
      url: `${this.baseUrl}/v1/internal/orders/${encodeURIComponent(orderId)}/confirm`,
      apiKey: this.apiKey,
      correlationId,
      body: { transactionId },
      timeoutMs: this.timeoutMs,
    });
    if (res.status === 200) {
      return 'CONFIRMED';
    }
    if (res.status === 409 && errorCodeOf(res.data) === 'ORDER_NOT_CONFIRMABLE') {
      return 'NOT_CONFIRMABLE';
    }
    throw unexpectedStatus(NAME, res.status);
  }
}
