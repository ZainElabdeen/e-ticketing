import { type ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ApiKeyGuard, type ApiKeys, Internal, Public } from './api-key.guard';

const PUBLIC_KEY = 'p'.repeat(32);
const INTERNAL_KEY = 'i'.repeat(32);

class Plain {
  handler(): void {}
}
class Flagged {
  @Internal()
  handler(): void {}
}
class Marked {
  @Public()
  handler(): void {}
}

function ctx(path: string, key?: string, target: new () => object = Plain): ExecutionContext {
  const headers: Record<string, string> = key === undefined ? {} : { 'x-api-key': key };
  return {
    switchToHttp: () => ({ getRequest: () => ({ path, headers }) }),
    getHandler: () => (target.prototype as { handler: () => void }).handler,
    getClass: () => target,
  } as unknown as ExecutionContext;
}

describe('ApiKeyGuard', () => {
  const keys: ApiKeys = { publicKey: PUBLIC_KEY, internalKey: INTERNAL_KEY };
  const guard = new ApiKeyGuard(new Reflector(), keys);
  const confirm = '/v1/internal/orders/x/confirm';

  it('rejects a missing key', () => {
    expect(() => guard.canActivate(ctx('/v1/orders'))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong key', () => {
    expect(() => guard.canActivate(ctx('/v1/orders', 'q'.repeat(32)))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a wrong key of a different length without a RangeError', () => {
    expect(() => guard.canActivate(ctx('/v1/orders', 'x'))).toThrow(UnauthorizedException);
    expect(() => guard.canActivate(ctx('/v1/orders', 'x'.repeat(40)))).toThrow(
      UnauthorizedException,
    );
  });

  it('lets the public key use public routes', () => {
    expect(guard.canActivate(ctx('/v1/orders', PUBLIC_KEY))).toBe(true);
  });

  it('forbids the public key on internal routes', () => {
    expect(() => guard.canActivate(ctx(confirm, PUBLIC_KEY))).toThrow(ForbiddenException);
  });

  it('lets the internal key use both', () => {
    expect(guard.canActivate(ctx('/v1/orders', INTERNAL_KEY))).toBe(true);
    expect(guard.canActivate(ctx(confirm, INTERNAL_KEY))).toBe(true);
  });

  it('requires the internal key on an @Internal() handler whatever the path', () => {
    expect(() => guard.canActivate(ctx('/v1/other', PUBLIC_KEY, Flagged))).toThrow(
      ForbiddenException,
    );
    expect(guard.canActivate(ctx('/v1/other', INTERNAL_KEY, Flagged))).toBe(true);
  });

  it.each(['/V1/INTERNAL/orders/x/confirm', '//v1//internal/orders/x/confirm'])(
    'forbids the public key on %s',
    (path) => {
      expect(() => guard.canActivate(ctx(path, PUBLIC_KEY))).toThrow(ForbiddenException);
    },
  );

  it('skips @Public() handlers', () => {
    expect(guard.canActivate(ctx('/health/live', undefined, Marked))).toBe(true);
  });

  it('ApiKeyGuard without internalKey forbids an @Internal() route for the public key', () => {
    const publicOnly = new ApiKeyGuard(new Reflector(), { publicKey: PUBLIC_KEY });
    expect(() => publicOnly.canActivate(ctx('/v1/other', PUBLIC_KEY, Flagged))).toThrow(
      ForbiddenException,
    );
    expect(() => publicOnly.canActivate(ctx(confirm, PUBLIC_KEY))).toThrow(ForbiddenException);
    expect(publicOnly.canActivate(ctx('/v1/orders', PUBLIC_KEY))).toBe(true);
  });
});
