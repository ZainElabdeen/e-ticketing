import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_SCOPE = 'gateway:rate-limit-scope';

/** Names a per-route budget; the limit itself comes from validated config. */
export type RateLimitScope = 'orders' | 'login';
export const RateLimit = (scope: RateLimitScope) => SetMetadata(RATE_LIMIT_SCOPE, scope);
