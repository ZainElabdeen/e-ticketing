import { HttpService } from '@nestjs/axios';
import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorService,
  type HealthIndicatorResult,
} from '@nestjs/terminus';
import { firstValueFrom } from 'rxjs';
import type { EnvironmentVariables } from '../config/env';

const PROBE_TIMEOUT_MS = 2000;

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly http: HttpService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  /** Liveness never calls a downstream service. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  /** Each downstream's public /health/live, in parallel, no API key. */
  @Get('ready')
  @HealthCheck()
  ready() {
    const probe = (name: string, base: string) => () => this.ping(name, base);
    return this.health.check([
      probe('ticket-service', this.config.get('TICKET_SERVICE_URL', { infer: true })),
      probe('payment-service', this.config.get('PAYMENT_SERVICE_URL', { infer: true })),
      probe('ledger-service', this.config.get('LEDGER_SERVICE_URL', { infer: true })),
    ]);
  }

  private async ping(name: string, base: string): Promise<HealthIndicatorResult> {
    const check = this.indicator.check(name);
    try {
      const res = await firstValueFrom(
        this.http.get<unknown>(`${base.replace(/\/+$/, '')}/health/live`, {
          timeout: PROBE_TIMEOUT_MS,
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
          validateStatus: () => true,
          maxRedirects: 0,
        }),
      );
      return res.status === 200 ? check.up() : check.down({ message: `status ${res.status}` });
    } catch {
      return check.down({ message: 'unreachable' });
    }
  }
}
