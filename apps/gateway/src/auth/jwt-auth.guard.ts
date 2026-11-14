import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { JWT_ISSUER } from './auth.service';

const BEARER = /^Bearer ([A-Za-z0-9._-]+)$/;

/** Only the Authorization header counts: tokens in query strings or cookies are ignored. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, unknown> }>();
    const header = req.headers['authorization'];
    const match = typeof header === 'string' ? BEARER.exec(header) : null;
    if (!match) {
      throw new UnauthorizedException('Missing or invalid token');
    }
    try {
      this.jwt.verify(match[1]!, { algorithms: ['HS256'], issuer: JWT_ISSUER });
    } catch {
      throw new UnauthorizedException('Missing or invalid token');
    }
    return true;
  }
}
