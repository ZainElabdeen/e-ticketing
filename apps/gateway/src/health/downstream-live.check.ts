import { HttpService } from '@nestjs/axios';
import { Injectable, type Type } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { trimTrailingSlashes, type ReadinessCheck } from '@eticket/nest-common';
import type { EnvironmentVariables } from '../config/env';

const PROBE_TIMEOUT_MS = 2000;

type DownstreamUrlKey = 'TICKET_SERVICE_URL' | 'PAYMENT_SERVICE_URL' | 'LEDGER_SERVICE_URL';

/**
 * Readiness check that calls a downstream service's public `/health/live`
 * (no API key). The check name is the service name `assertGateway` reads.
 * Rejects on anything but 200, so the shared module reports it down.
 */
function downstreamLiveCheck(name: string, urlKey: DownstreamUrlKey): Type<ReadinessCheck> {
  @Injectable()
  class DownstreamLiveCheck implements ReadinessCheck {
    readonly name = name;

    constructor(
      private readonly http: HttpService,
      private readonly config: ConfigService<EnvironmentVariables, true>,
    ) {}

    async check(): Promise<void> {
      const base = this.config.get(urlKey, { infer: true });
      const res = await firstValueFrom(
        this.http.get<unknown>(`${trimTrailingSlashes(base)}/health/live`, {
          timeout: PROBE_TIMEOUT_MS,
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          validateStatus: () => true,
          maxRedirects: 0,
        }),
      );
      if (res.status !== 200) throw new Error(`status ${res.status}`);
    }
  }
  return DownstreamLiveCheck;
}

export const DOWNSTREAM_LIVE_CHECKS: Type<ReadinessCheck>[] = [
  downstreamLiveCheck('ticket-service', 'TICKET_SERVICE_URL'),
  downstreamLiveCheck('payment-service', 'PAYMENT_SERVICE_URL'),
  downstreamLiveCheck('ledger-service', 'LEDGER_SERVICE_URL'),
];
