import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import type { EnvironmentVariables } from '../config/env';

/**
 * Prisma client over node-postgres. It connects lazily on the first query, so
 * the app boots with the database down and `/health/ready` reports it. The
 * `tickets_app` role's search_path already points at the `tickets` schema.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(config: ConfigService<EnvironmentVariables, true>) {
    super({ adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL') }) });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
