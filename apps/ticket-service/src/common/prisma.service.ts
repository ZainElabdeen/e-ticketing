import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { EnvironmentVariables } from '../config/env';

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
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    const url = config.get<string>('DATABASE_URL');
    super({ adapter: new PrismaPg({ connectionString: url }, { schema: schemaOf(url) }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
