import {
  type BeforeApplicationShutdown,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CLOCK, type Clock } from '../common/clock';
import type { EnvironmentVariables } from '../config/env';
import { PaymentsRepository } from './payments.repository';

const INTERVAL_NAME = 'qr-success';
const CORRELATION_ID = 'job:qr-success';

/** Marks QR payments SUCCEEDED once their simulated delay has passed. */
@Injectable()
export class QrSuccessJob implements OnModuleInit, OnModuleDestroy, BeforeApplicationShutdown {
  private readonly logger = new Logger(QrSuccessJob.name);
  private running = false;
  private inFlight: Promise<number> | undefined;

  constructor(
    private readonly repository: PaymentsRepository,
    private readonly config: ConfigService<EnvironmentVariables, true>,
    private readonly scheduler: SchedulerRegistry,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    if (!this.config.get('QR_JOB_ENABLED', { infer: true })) {
      return;
    }
    const seconds = this.config.get('QR_JOB_INTERVAL_SECONDS', { infer: true });
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

  /** Lets an in-flight run finish before Nest closes the HTTP server and the DB pool. */
  async beforeApplicationShutdown(): Promise<void> {
    await this.inFlight?.catch(() => undefined);
  }

  /** Succeeds due QR payments, up to QR_JOB_BATCH_SIZE. Returns how many. */
  runOnce(): Promise<number> {
    const run = this.succeedBatch();
    this.inFlight = run;
    const clear = (): void => {
      if (this.inFlight === run) {
        this.inFlight = undefined;
      }
    };
    run.then(clear, clear);
    return run;
  }

  private async succeedBatch(): Promise<number> {
    const batch = this.config.get('QR_JOB_BATCH_SIZE', { infer: true });
    let succeeded = 0;
    while (succeeded < batch) {
      const id = await this.repository.succeedOneDueQr(this.clock.now());
      if (id === null) {
        break;
      }
      succeeded += 1;
    }
    return succeeded;
  }

  /** Interval entry point: skips while a run is in progress, never throws. */
  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;
    try {
      const succeeded = await this.runOnce();
      if (succeeded > 0) {
        this.logger.log({ correlationId: CORRELATION_ID, succeeded }, 'succeeded due QR payments');
      }
    } catch (err) {
      this.logger.error({ correlationId: CORRELATION_ID, err }, 'QR success run failed');
    } finally {
      this.running = false;
    }
  }
}
