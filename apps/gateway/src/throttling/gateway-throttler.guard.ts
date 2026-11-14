import { createHash } from 'node:crypto';
import { Injectable, type ExecutionContext } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

/**
 * Two buckets per client IP (`req.ip`, which Express derives from
 * `trust proxy`):
 * - `default`: ONE pool shared by every non-health route;
 * - `scoped`: a per-scope budget for routes tagged with @RateLimit.
 * The wire contract carries a plain `Retry-After`, whichever bucket tripped.
 */
@Injectable()
export class GatewayThrottlerGuard extends ThrottlerGuard {
  protected override generateKey(context: ExecutionContext, tracker: string, name: string): string {
    if (name === 'default') {
      return createHash('sha256').update(`${tracker}:default`).digest('hex');
    }
    return super.generateKey(context, tracker, name);
  }

  protected override setResponseHeader(
    res: Record<string, unknown>,
    name: string,
    value: string | number,
  ): void {
    super.setResponseHeader(res, name === 'Retry-After-scoped' ? 'Retry-After' : name, value);
  }
}
