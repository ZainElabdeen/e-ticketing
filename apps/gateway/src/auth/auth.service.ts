import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import bcrypt from 'bcryptjs';
import type { EnvironmentVariables } from '../config/env';
import { decodeAdminHash } from '../config/admin-hash';
import { JWT_ISSUER, TOKEN_TTL_SECONDS } from './constants';
import { InvalidCredentialsError } from './errors';

@Injectable()
export class AuthService {
  private readonly adminEmail: string;
  private readonly adminHash: string;
  /**
   * Compared against when the email does not match, so an unknown email costs the
   * same bcrypt work as a wrong password. Same cost as the admin hash; random input.
   */
  private readonly dummyHash: string;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<EnvironmentVariables, true>,
  ) {
    this.adminEmail = config.get('ADMIN_EMAIL', { infer: true }).trim().toLowerCase();
    this.adminHash = decodeAdminHash(config.get('ADMIN_PASSWORD_HASH_B64', { infer: true }));
    this.dummyHash = bcrypt.hashSync(
      randomBytes(24).toString('hex'),
      bcrypt.getRounds(this.adminHash),
    );
  }

  /** Whether the email is the admin's; the audit log records this, never the email. */
  emailMatches(email: string): boolean {
    return email.trim().toLowerCase() === this.adminEmail;
  }

  /** Always runs one bcrypt compare, against a dummy hash when the email is unknown. */
  async login(
    email: string,
    password: string,
  ): Promise<{ accessToken: string; expiresIn: number }> {
    const emailMatches = this.emailMatches(email);
    const passwordOk = await bcrypt.compare(
      password,
      emailMatches ? this.adminHash : this.dummyHash,
    );
    if (!(emailMatches && passwordOk)) {
      throw new InvalidCredentialsError();
    }
    const accessToken = await this.jwt.signAsync(
      { sub: this.adminEmail },
      { algorithm: 'HS256', issuer: JWT_ISSUER, expiresIn: TOKEN_TTL_SECONDS },
    );
    return { accessToken, expiresIn: TOKEN_TTL_SECONDS };
  }
}
