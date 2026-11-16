import { Inject, Injectable, type Type } from '@nestjs/common';
import type { ReadinessCheck } from './readiness-check';

/**
 * Readiness check named `database` that runs `SELECT 1`. Structural on purpose:
 * nest-common never imports an app's generated Prisma client.
 */
export function prismaReadinessCheck(
  token: Type<{ $queryRawUnsafe(sql: string): Promise<unknown> }>,
): Type<ReadinessCheck> {
  @Injectable()
  class PrismaReadinessCheck implements ReadinessCheck {
    readonly name = 'database';

    constructor(
      @Inject(token) private readonly prisma: { $queryRawUnsafe(sql: string): Promise<unknown> },
    ) {}

    async check(): Promise<void> {
      await this.prisma.$queryRawUnsafe('SELECT 1');
    }
  }
  return PrismaReadinessCheck;
}
