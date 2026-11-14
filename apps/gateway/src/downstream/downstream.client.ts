import { HttpService } from '@nestjs/axios';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isAxiosError } from 'axios';
import { firstValueFrom } from 'rxjs';
import type { EnvironmentVariables } from '../config/env';
import { UpstreamTimeoutError, UpstreamUnavailableError } from './errors';

export type Service = 'ticket' | 'payment' | 'ledger';

export interface DownstreamResult {
  status: number;
  body: unknown;
  /** Only `idempotent-replayed` (lowercased), and only when the downstream sent it. */
  headers: Record<string, string>;
}

export interface SendOptions {
  correlationId: string;
  body?: unknown;
  query?: Record<string, string>;
  idempotencyKey?: string;
}

// ERR_CANCELED is what axios reports when the AbortSignal.timeout() below fires.
const TIMEOUT_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ERR_CANCELED']);

const SERVICE_NAMES: Record<Service, string> = {
  ticket: 'ticket-service',
  payment: 'payment-service',
  ledger: 'ledger-service',
};

const URL_VARS = {
  ticket: 'TICKET_SERVICE_URL',
  payment: 'PAYMENT_SERVICE_URL',
  ledger: 'LEDGER_SERVICE_URL',
} as const;

const KEY_VARS = {
  ticket: 'PUBLIC_API_KEY_TICKET',
  payment: 'PUBLIC_API_KEY_PAYMENT',
  ledger: 'PUBLIC_API_KEY_LEDGER',
} as const;

/** The slice of an Express response that relay needs. */
export interface RelayTarget {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown };
}

@Injectable()
export class DownstreamClient {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /**
   * One call to a downstream service. Resolves for any 2xx/4xx/5xx with a JSON body.
   * Throws UpstreamTimeoutError / UpstreamUnavailableError for transport failures,
   * 3xx and non-JSON bodies; messages name the service only. No retries.
   */
  async send(
    service: Service,
    method: 'GET' | 'POST',
    path: string,
    opts: SendOptions,
  ): Promise<DownstreamResult> {
    const name = SERVICE_NAMES[service];
    // Built explicitly: client headers are never spread in.
    const headers: Record<string, string> = {
      'X-Api-Key': this.keyFor(service),
      'X-Correlation-Id': opts.correlationId,
    };
    if (opts.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (opts.idempotencyKey !== undefined) {
      headers['Idempotency-Key'] = opts.idempotencyKey;
    }
    const timeoutMs = this.config.get('DOWNSTREAM_TIMEOUT_MS', { infer: true });
    let res;
    try {
      res = await firstValueFrom(
        this.http.request<unknown>({
          method,
          url: `${this.baseFor(service)}${path}`,
          params: opts.query,
          data: opts.body,
          headers,
          timeout: timeoutMs,
          // axios `timeout` only covers idle sockets; the signal bounds the whole call.
          signal: AbortSignal.timeout(timeoutMs),
          validateStatus: () => true,
          maxRedirects: 0,
        }),
      );
    } catch (error) {
      const code = isAxiosError(error) ? error.code : undefined;
      if (code !== undefined && TIMEOUT_CODES.has(code)) {
        throw new UpstreamTimeoutError(`${name} timed out`);
      }
      throw new UpstreamUnavailableError(`${name} is unreachable`);
    }
    const contentType = String(res.headers['content-type'] ?? '');
    const isJson = contentType.includes('json') && typeof res.data !== 'string';
    const redirect = res.status >= 300 && res.status < 400;
    if (redirect || !isJson) {
      throw new UpstreamUnavailableError(`${name} answered with an unexpected response`);
    }
    const replayed: unknown = res.headers['idempotent-replayed'];
    return {
      status: res.status,
      body: res.data,
      headers: typeof replayed === 'string' ? { 'idempotent-replayed': replayed } : {},
    };
  }

  private baseFor(service: Service): string {
    const url = this.config.get(URL_VARS[service], { infer: true });
    return url.replace(/\/+$/, '');
  }

  private keyFor(service: Service): string {
    return this.config.get(KEY_VARS[service], { infer: true });
  }
}

/** Sends the downstream status and JSON body verbatim, plus the allow-listed headers. */
export function relay(res: RelayTarget, result: DownstreamResult): void {
  for (const [name, value] of Object.entries(result.headers)) {
    res.setHeader(name, value);
  }
  res.status(result.status).json(result.body);
}
