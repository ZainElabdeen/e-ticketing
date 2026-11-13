import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Max,
  Min,
  MinLength,
  validateSync,
  ValidateBy,
  type ValidationOptions,
} from 'class-validator';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** `'true'`/`'false'` become booleans; anything else is left for `@IsBoolean` to reject. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

function DiffersFrom(other: keyof EnvironmentVariables, options?: ValidationOptions) {
  return ValidateBy(
    {
      name: 'differsFrom',
      constraints: [other],
      validator: {
        validate: (value: unknown, args) =>
          value !== (args?.object as Record<string, unknown>)[other as string],
        defaultMessage: (args) => `${args?.property} must differ from ${other}`,
      },
    },
    options,
  );
}

export class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3001;

  @IsString()
  @IsNotEmpty()
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  PUBLIC_API_KEY_TICKET!: string;

  @IsString()
  @MinLength(32)
  @DiffersFrom('PUBLIC_API_KEY_TICKET')
  INTERNAL_API_KEY_TICKET!: string;

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = false;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: string = 'info';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  ORDER_TTL_MINUTES: number = 15;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  ORDER_EXPIRY_INTERVAL_SECONDS: number = 60;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  ORDER_EXPIRY_BATCH_SIZE: number = 100;

  @Transform(toBoolean)
  @IsBoolean()
  ORDER_EXPIRY_ENABLED: boolean = true;
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
