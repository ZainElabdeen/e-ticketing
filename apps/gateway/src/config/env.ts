import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
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

export class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3000;

  @IsUrl(URL_OPTIONS)
  TICKET_SERVICE_URL!: string;

  @IsUrl(URL_OPTIONS)
  PAYMENT_SERVICE_URL!: string;

  @IsUrl(URL_OPTIONS)
  LEDGER_SERVICE_URL!: string;

  @IsString()
  @MinLength(32)
  PUBLIC_API_KEY_TICKET!: string;

  @IsString()
  @MinLength(32)
  PUBLIC_API_KEY_PAYMENT!: string;

  @IsString()
  @MinLength(32)
  PUBLIC_API_KEY_LEDGER!: string;

  @IsString()
  @MinLength(32)
  JWT_SECRET!: string;

  @IsEmail()
  ADMIN_EMAIL!: string;

  @IsAdminHashB64()
  ADMIN_PASSWORD_HASH_B64!: string;

  @IsUrl(URL_OPTIONS)
  WEB_ORIGIN!: string;

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = false;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: string = 'info';

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(30000)
  DOWNSTREAM_TIMEOUT_MS: number = 5000;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(5)
  TRUST_PROXY: number = 0;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_DEFAULT_PER_MIN: number = 100;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_ORDERS_PER_MIN: number = 5;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  RATE_LIMIT_LOGIN_PER_MIN: number = 10;
}

/** Throws one Error that lists every invalid variable. */
export function validateEnv(raw: Record<string, unknown>): EnvironmentVariables {
  const env = plainToInstance(EnvironmentVariables, raw, { exposeDefaultValues: true });
  const errors = validateSync(env, { skipMissingProperties: false });
  if (errors.length > 0) {
    const lines = errors.flatMap((e) =>
      Object.values(e.constraints ?? {}).map((message) => `  - ${message}`),
    );
    throw new Error(`Invalid environment:\n${lines.join('\n')}`);
  }
  return env;
}
