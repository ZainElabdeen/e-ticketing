import { Inject, Injectable, type BeforeApplicationShutdown } from '@nestjs/common';

/** Injection token for the drain wait in milliseconds. */
export const SHUTDOWN_DRAIN_MS = Symbol('SHUTDOWN_DRAIN_MS');

/**
 * Flips readiness to "draining" and waits `drainMs` BEFORE Nest closes the HTTP
 * server, so the load balancer stops routing while in-flight requests finish
 * (skill §11.7: onModuleDestroy, beforeApplicationShutdown, server close).
 */
@Injectable()
export class ShutdownState implements BeforeApplicationShutdown {
  private isDraining = false;

  constructor(@Inject(SHUTDOWN_DRAIN_MS) private readonly drainMs: number) {}

  get draining(): boolean {
    return this.isDraining;
  }

  async beforeApplicationShutdown(): Promise<void> {
    this.isDraining = true;
    if (this.drainMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, this.drainMs));
    }
  }
}
