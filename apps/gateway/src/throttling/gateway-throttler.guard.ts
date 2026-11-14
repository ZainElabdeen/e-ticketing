import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerGuard,
  type ThrottlerModuleOptions,
  type ThrottlerRequest,
  type ThrottlerStorage,
} from '@nestjs/throttler';
import type { EnvironmentVariables } from '../config/env';
import { RATE_LIMIT_SCOPE, type RateLimitScope } from './rate-limit';

const SCOPE_KEYS = {
  orders: 'RATE_LIMIT_ORDERS_PER_MIN',
  login: 'RATE_LIMIT_LOGIN_PER_MIN',
} as const satisfies Record<RateLimitScope, keyof EnvironmentVariables>;

/**
 * Per client IP (`req.ip`, which Express derives from `trust proxy`), one
 * counter per route. A route tagged with @RateLimit gets its own env-driven
 * limit; everything else uses the default. Rejected calls do not extend the
 * window, and `Retry-After` is the seconds until the oldest hit expires.
 */
@Injectable()
export class GatewayThrottlerGuard extends ThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storage: ThrottlerStorage,
    reflector: Reflector,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {
    super(options, storage, reflector);
  }

  protected override async handleRequest(props: ThrottlerRequest): Promise<boolean> {
    const scope = this.reflector.getAllAndOverride<RateLimitScope | undefined>(RATE_LIMIT_SCOPE, [
      props.context.getHandler(),
      props.context.getClass(),
    ]);
    const limit = scope ? this.config.get(SCOPE_KEYS[scope], { infer: true }) : props.limit;
    return super.handleRequest({ ...props, limit, blockDuration: 0 });
  }

  protected override setResponseHeader(
    res: Record<string, unknown>,
    name: string,
    value: string | number,
  ): void {
    // The library can report 0 s when the window ends within the second.
    super.setResponseHeader(res, name, name === 'Retry-After' ? Math.max(1, Number(value)) : value);
  }
}
