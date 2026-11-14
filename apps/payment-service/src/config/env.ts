import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  IsUrl,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
} from 'class-validator';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** `'true'`/`'false'` become booleans; anything else is left for `@IsBoolean` to reject. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

const URL_OPTIONS = { require_tld: false, protocols: ['http', 'https'], require_protocol: true };

export class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3002;

  @IsString()
  @IsNotEmpty()
  @Matches(/[?&]schema=payments(&|$)/, { message: 'DATABASE_URL must contain ?schema=payments' })
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  PUBLIC_API_KEY_PAYMENT!: string;

  @IsUrl(URL_OPTIONS)
  TICKET_SERVICE_URL!: string;

  @IsUrl(URL_OPTIONS)
  LEDGER_SERVICE_URL!: string;

  @IsString()
  @MinLength(32)
  INTERNAL_API_KEY_TICKET!: string;

  @IsString()
  @MinLength(32)
  INTERNAL_API_KEY_LEDGER!: string;

  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(30000)
  DOWNSTREAM_TIMEOUT_MS: number = 5000;

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = false;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: string = 'info';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(300)
  QR_SUCCESS_DELAY_SECONDS: number = 8;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  QR_JOB_INTERVAL_SECONDS: number = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  QR_JOB_BATCH_SIZE: number = 50;

  @Transform(toBoolean)
  @IsBoolean()
  QR_JOB_ENABLED: boolean = true;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  OUTBOX_INTERVAL_SECONDS: number = 2;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  OUTBOX_BATCH_SIZE: number = 10;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  OUTBOX_MAX_ATTEMPTS: number = 10;

  @Transform(toBoolean)
  @IsBoolean()
  OUTBOX_ENABLED: boolean = true;
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
