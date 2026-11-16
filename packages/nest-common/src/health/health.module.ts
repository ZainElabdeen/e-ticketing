import { type DynamicModule, Module, type ModuleMetadata, type Type } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HEALTH_TIMEOUT_MS, HealthController, READINESS_CHECKS } from './health.controller';
import type { ReadinessCheck } from './readiness-check';
import { SHUTDOWN_DRAIN_MS, ShutdownState } from './shutdown-state';

export interface HealthModuleOptions {
  /** Modules that export what the checks inject (e.g. the DB module, HttpModule). */
  imports?: ModuleMetadata['imports'];
  /** Provider classes, instantiated by Nest, one per hard dependency. */
  checks: Type<ReadinessCheck>[];
  /** Per-check timeout; a hung check reports down. Default 2000. */
  timeoutMs?: number;
  /** Wait between readiness failing and the HTTP server closing. Default 5000. */
  drainMs?: number;
}

@Module({})
export class HealthModule {
  static forRoot(opts: HealthModuleOptions): DynamicModule {
    return {
      module: HealthModule,
      imports: [TerminusModule, ...(opts.imports ?? [])],
      controllers: [HealthController],
      providers: [
        ...opts.checks,
        ShutdownState,
        { provide: SHUTDOWN_DRAIN_MS, useValue: opts.drainMs ?? 5000 },
        { provide: HEALTH_TIMEOUT_MS, useValue: opts.timeoutMs ?? 2000 },
        {
          provide: READINESS_CHECKS,
          useFactory: (...checks: ReadinessCheck[]) => checks,
          inject: opts.checks,
        },
      ],
    };
  }
}
