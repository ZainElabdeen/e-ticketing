import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { CorrelatedRequest } from '@eticket/nest-common';
import { correlationIdOf } from '@eticket/nest-common';
import { RateLimit } from '../throttling/rate-limit';
import { AuthService } from './auth.service';
import { InvalidCredentialsError } from './errors';
import { LoginDto } from './login.dto';

@Controller('v1/auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(AuthController.name);
  }

  @Post('login')
  @RateLimit('login')
  @HttpCode(200)
  async login(
    @Req() req: CorrelatedRequest & { ip?: string },
    @Body() dto: LoginDto,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    // Audit line: whether the email matched is enough to spot probing. The
    // submitted email, the password and the token are never logged.
    const audit = {
      event: 'auth.login',
      emailMatched: this.auth.emailMatches(dto.email),
      ip: req.ip,
      correlationId: correlationIdOf(req),
    };
    try {
      const token = await this.auth.login(dto.email, dto.password);
      this.logger.info({ ...audit, outcome: 'success' }, 'login attempt');
      return token;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        this.logger.warn({ ...audit, outcome: 'invalid_credentials' }, 'login attempt');
      }
      throw error;
    }
  }
}
