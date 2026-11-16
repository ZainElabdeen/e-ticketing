import { Controller, Get, Inject } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  type HealthIndicatorFunction,
  HealthIndicatorService,
} from '@nestjs/terminus';
import { Public } from '../api-key.guard';
import type { ReadinessCheck } from './readiness-check';
import { ShutdownState } from './shutdown-state';

export const READINESS_CHECKS = Symbol('READINESS_CHECKS');
export const HEALTH_TIMEOUT_MS = Symbol('HEALTH_TIMEOUT_MS');

class CheckTimeoutError extends Error {}

@Public()
// Throttling exemption is the app's concern (its throttler guard skips /health/*).
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly indicator: HealthIndicatorService,
    private readonly shutdown: ShutdownState,
    @Inject(READINESS_CHECKS) private readonly checks: ReadinessCheck[],
    @Inject(HEALTH_TIMEOUT_MS) private readonly timeoutMs: number,
  ) {}

  /** Liveness is process-only: it never touches a dependency. */
  @Get('live')
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }

  @Get('ready')
  @HealthCheck()
  ready() {
    const indicators: HealthIndicatorFunction[] = this.checks.map((c) => () => this.run(c));
    if (this.shutdown.draining) {
      indicators.unshift(() =>
        Promise.resolve(
          this.indicator
            .check('shutdown')
            .down({ message: 'shutting_down', reason: 'shutting_down' }),
        ),
      );
    }
    return this.health.check(indicators);
  }

  private async run(check: ReadinessCheck) {
    const result = this.indicator.check(check.name);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new CheckTimeoutError()), this.timeoutMs);
    });
    try {
      await Promise.race([check.check(), timeout]);
      return result.up();
    } catch (err) {
      return result.down({ message: err instanceof CheckTimeoutError ? 'timeout' : 'unavailable' });
    } finally {
      clearTimeout(timer);
    }
  }
}
