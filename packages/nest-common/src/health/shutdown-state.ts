import { Inject, Injectable, type BeforeApplicationShutdown } from '@nestjs/common';

/** Injection token for the drain wait in milliseconds. */
export const SHUTDOWN_DRAIN_MS = Symbol('SHUTDOWN_DRAIN_MS');

/**
 * Flips readiness to "draining" and waits `drainMs` BEFORE Nest closes the HTTP
 * server. This is the in-app equivalent of a preStop sleep: it covers endpoint
 * propagation after SIGTERM (K8s marks the pod terminating and proxies stop
 * routing) while in-flight requests finish. The readiness 503 is only a
 * secondary signal for external pollers (skill §11.7: onModuleDestroy, beforeApplicationShutdown, server close).
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
