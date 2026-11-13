import { timingSafeEqual } from 'node:crypto';
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { EnvironmentVariables } from '../../config/env';

export const IS_PUBLIC = 'isPublic';
/** Marks a route (or controller) as needing no API key: health and docs. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const IS_INTERNAL = 'isInternal';
/** Marks a route (or controller) as internal-scope: only the internal key passes. */
export const Internal = () => SetMetadata(IS_INTERNAL, true);

const INTERNAL_PREFIX = '/v1/internal/';

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual throws on unequal lengths; a length mismatch is a mismatch.
  return left.length === right.length && timingSafeEqual(left, right);
}

interface KeyedRequest {
  path?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}

/**
 * Two key scopes. The public key is accepted on /v1/* except /v1/internal/*;
 * the internal key is accepted everywhere under /v1/*.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<KeyedRequest>();
    const header = req.headers['x-api-key'];
    const presented = Array.isArray(header) ? header[0] : header;
    if (!presented) {
      throw new UnauthorizedException('Missing or invalid API key');
    }

    const internal = safeEqual(presented, this.config.get('INTERNAL_API_KEY_TICKET'));
    const pub = safeEqual(presented, this.config.get('PUBLIC_API_KEY_TICKET'));
    if (!internal && !pub) {
      throw new UnauthorizedException('Missing or invalid API key');
    }

    const isInternalRoute =
      this.reflector.getAllAndOverride<boolean | undefined>(IS_INTERNAL, [
        context.getHandler(),
        context.getClass(),
      ]) === true;
    // Defense in depth: the path check survives a route that forgot @Internal().
    // Normalised, because Express matches case-insensitively by default.
    const raw = req.path ?? (req.url ?? '').split('?')[0] ?? '';
    const path = raw.toLowerCase().replace(/\/{2,}/g, '/');
    if ((isInternalRoute || path.startsWith(INTERNAL_PREFIX)) && !internal) {
      throw new ForbiddenException('This key is not allowed on internal routes');
    }
    return true;
  }
}
