import {
  type BeforeApplicationShutdown,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { EnvironmentVariables } from '../config/env';
import { OrdersRepository } from './orders.repository';

const INTERVAL_NAME = 'order-expiry';
const CORRELATION_ID = 'job:order-expiry';

/** Releases the reservations of PENDING orders whose 15 minutes have passed. */
@Injectable()
export class OrderExpiryJob implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(OrderExpiryJob.name);
  private running = false;
  private inFlight: Promise<number> | undefined;

  constructor(
    private readonly repository: OrdersRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('ORDER_EXPIRY_ENABLED', { infer: true })) {
      return;
    }
    const seconds = this.config.get('ORDER_EXPIRY_INTERVAL_SECONDS', { infer: true });
    this.scheduler.addInterval(
      INTERVAL_NAME,
      setInterval(() => void this.tick(), seconds * 1000),
    );
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('interval', INTERVAL_NAME)) {
      this.scheduler.deleteInterval(INTERVAL_NAME);
    }
  }

  /**
   * Runs before Nest stops the HTTP server and the database pool: the interval is
   * already gone (onModuleDestroy), so waiting here lets an in-flight run finish.
   */
  async beforeApplicationShutdown(): Promise<void> {
    await this.inFlight?.catch(() => undefined);
  }

  /** Expires due orders, up to ORDER_EXPIRY_BATCH_SIZE. Returns how many. */
  runOnce(): Promise<number> {
    const run = this.expireBatch();
    this.inFlight = run;
    const clear = (): void => {
      if (this.inFlight === run) {
        this.inFlight = undefined;
      }
    };
    run.then(clear, clear);
    return run;
  }

  private async expireBatch(): Promise<number> {
    const batch = this.config.get('ORDER_EXPIRY_BATCH_SIZE', { infer: true });
    let expired = 0;
    while (expired < batch) {
      const id = await this.repository.expireOne();
      if (id === null) {
        break;
      }
      expired += 1;
    }
    return expired;
  }

  /** Interval entry point: skips while a run is in progress, never throws. */
  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const expired = await this.runOnce();
      if (expired > 0) {
        this.logger.log({ correlationId: CORRELATION_ID, expired }, 'expired unpaid orders');
      }
    } catch (err) {
      this.logger.error(
        { correlationId: CORRELATION_ID, err },
        'order expiry run failed',
      );
    } finally {
      this.running = false;
    }
  }
}
