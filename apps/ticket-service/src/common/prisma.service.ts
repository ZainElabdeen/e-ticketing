import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { EnvironmentVariables } from '../config/env';

/** Fail a request in 5 s instead of hanging when the database is unreachable. */
const CONNECT_TIMEOUT_MS = 5000;

/** adapter-pg ignores the `?schema=` URL parameter, so read it here; without it queries go to `public`. */
export function schemaOf(databaseUrl: string): string {
  try {
    return new URL(databaseUrl).searchParams.get('schema') ?? 'tickets';
  } catch {
    return 'tickets';
  }
}

/**
 * Prisma client over node-postgres. It connects lazily on the first query, so
 * the app boots with the database down and `/health/ready` reports it.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnApplicationShutdown {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const url = config.get<string>('DATABASE_URL');
    super({ adapter: new PrismaPg(
        { connectionString: url, connectionTimeoutMillis: CONNECT_TIMEOUT_MS },
        { schema: schemaOf(url) },
      ) });
  }

  /** After the HTTP server has closed, so in-flight requests never lose the pool. */
  async onApplicationShutdown(): Promise<void> {
    await this.$disconnect();
  }
}
