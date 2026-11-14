import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { schemaOf } from '@eticket/nest-common';
import type { EnvironmentVariables } from '../config/env';

/** Fail a request in 5 s instead of hanging when the database is unreachable. */
const CONNECT_TIMEOUT_MS = 5000;

/**
 * Prisma client over node-postgres. It connects lazily on the first query, so
 * the app boots with the database down and `/health/ready` reports it.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const url = config.get<string>('DATABASE_URL');
    super({
      adapter: new PrismaPg(
        { connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS },
        { schema: schemaOf(url, 'ledger') },
      ),
    });
  }

  /** After the HTTP server has closed, so in-flight requests never lose the pool. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
