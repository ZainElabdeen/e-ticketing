import 'reflect-metadata';
import { Expose, plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsInt,
  IsString,
  IsUrl,
  Max,
  Min,
  MinLength,
  registerDecorator,
  validateSync,
} from 'class-validator';
import { decodeAdminHash } from './admin-hash';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** `'true'`/`'false'` become booleans; anything else is left for `@IsBoolean` to reject. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

const URL_OPTIONS = { require_tld: false, protocols: ['http', 'https'], require_protocol: true };

/** Passes when decodeAdminHash accepts the value; its message names the problem, never the value. */
function IsAdminHashB64() {
  return (target: object, propertyKey: string): void => {
    registerDecorator({
      name: 'isAdminHashB64',
      target: target.constructor,
      propertyName: propertyKey,
      validator: {
        validate: (value: unknown) => {
          try {
            decodeAdminHash(value as string);
            return true;
          } catch {
            return false;
          }
        },
        defaultMessage: (args) => {
          try {
            decodeAdminHash(args?.value as string);
          } catch (error) {
            return (error as Error).message;
          }
          return 'ADMIN_PASSWORD_HASH_B64 is invalid';
        },
      },
    });
  };
}

const PLACEHOLDER = /^(replace-with|change-me)/i;

/** Rejects the `.env.example` placeholders; the message never echoes the value. */
function IsNotPlaceholder() {
  return (target: object, propertyKey: string): void => {
    registerDecorator({
      name: 'isNotPlaceholder',
      target: target.constructor,
      propertyName: propertyKey,
      validator: {
        validate: (value: unknown) => typeof value !== 'string' || !PLACEHOLDER.test(value),
        defaultMessage: (args) =>
          `${args?.property ?? 'value'} is still a placeholder from .env.example; generate a real secret (openssl rand -hex 32)`,
      },
    });
  };
}

export class EnvironmentVariables {
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @Expose()
  @IsUrl(URL_OPTIONS)
  TICKET_SERVICE_URL!: string;

  @Expose()
  @IsUrl(URL_OPTIONS)
  PAYMENT_SERVICE_URL!: string;

  @Expose()
  @IsUrl(URL_OPTIONS)
  LEDGER_SERVICE_URL!: string;

  @Expose()
  @IsString()
  @MinLength(32)
  @IsNotPlaceholder()
  PUBLIC_API_KEY_TICKET!: string;

  @Expose()
  @IsString()
  @MinLength(32)
  @IsNotPlaceholder()
  PUBLIC_API_KEY_PAYMENT!: string;

  @Expose()
  @IsString()
  @MinLength(32)
  @IsNotPlaceholder()
  PUBLIC_API_KEY_LEDGER!: string;

  @Expose()
  @IsString()
  @MinLength(32)
  @IsNotPlaceholder()
  JWT_SECRET!: string;

  @Expose()
  @IsEmail()
  ADMIN_EMAIL!: string;

  @Expose()
  @IsAdminHashB64()
  ADMIN_PASSWORD_HASH_B64!: string;

  @Expose()
  @IsUrl(URL_OPTIONS)
  WEB_ORIGIN!: string;

  @Expose()
  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = false;

  @Expose()
  @IsIn(LOG_LEVELS)
  LOG_LEVEL: string = 'info';

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(30000)
  DOWNSTREAM_TIMEOUT_MS: number = 5000;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY: number = 0;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_DEFAULT_PER_MIN: number = 100;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_ORDERS_PER_MIN: number = 5;

  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_LOGIN_PER_MIN: number = 10;

  /** Rate-limit window length. Only tests shorten it; production keeps 60 s. */
  @Expose()
  @Type(() => Number)
  @IsInt()
  @Min(1000)
  @Max(3_600_000)
  RATE_LIMIT_WINDOW_MS: number = 60_000;
}

/** Throws one Error that lists every invalid variable. */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, raw, {
    exposeDefaultValues: true,
    excludeExtraneousValues: true,
  });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const lines = errors.flatMap((e) =>
      Object.values(e.constraints ?? {}).map((message) => `  - ${message}`),
    );
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return env;
}
