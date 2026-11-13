import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env';
import { callDownstream, errorCodeOf, unexpectedStatus } from './downstream-http';

export interface TicketOrder {
  id: string;
  status: 'PENDING' | 'CONFIRMED' | 'EXPIRED';
  totalMinor: number;
  currency: string;
  expiresAt: string;
}

export type ConfirmOutcome = 'CONFIRMED' | 'NOT_CONFIRMABLE';

const NAME = 'ticket-service';

@Injectable()
export class TicketClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.baseUrl = config.get<string>('TICKET_SERVICE_URL').replace(/\/+$/, '');
    this.apiKey = config.get<string>('INTERNAL_API_KEY_TICKET');
  }

  /** The order, or null when the Ticket Service has no such order (404). */
  async getOrder(orderId: string, correlationId: string): Promise<TicketOrder | null> {
    const res = await callDownstream(this.http, NAME, {
      method: 'GET',
      url: `${this.baseUrl}/v1/orders/${encodeURIComponent(orderId)}`,
      apiKey: this.apiKey,
      correlationId,
    });
    if (res.status === 404) {
      return null;
    }
    if (res.status !== 200) {
      throw unexpectedStatus(NAME, res.status);
    }
    const o = res.data as TicketOrder;
    return {
      id: o.id,
      status: o.status,
      totalMinor: o.totalMinor,
      currency: o.currency,
      expiresAt: o.expiresAt,
    };
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
