import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EnvironmentVariables } from '../config/env';
import { callDownstream, unexpectedStatus } from './downstream-http';

export type PostingType = 'TICKET_SALE' | 'UNFULFILLED_PAYMENT';

export interface PostingRequest {
  transactionId: string;
  postingType: PostingType;
  orderId: string;
  paymentReference: string;
  amountMinor: number;
  currency: string;
}

@Injectable()
export class LedgerClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(
    private readonly http: HttpService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.baseUrl = config.get<string>('LEDGER_SERVICE_URL').replace(/\/+$/, '');
    this.apiKey = config.get<string>('INTERNAL_API_KEY_LEDGER');
  }

  /** Resolves on 201 (posted) or 200 (idempotent replay); anything else throws (spec §4.4). */
  async post(req: PostingRequest, correlationId: string): Promise<void> {
    const res = await callDownstream(this.http, 'ledger-service', {
      method: 'POST',
      url: `${this.baseUrl}/v1/internal/postings`,
      apiKey: this.apiKey,
      correlationId,
      body: req,
    });
    if (res.status !== 200 && res.status !== 201) {
      throw unexpectedStatus('ledger-service', res.status);
    }
  }
}
