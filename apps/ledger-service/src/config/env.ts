import 'reflect-metadata';
import { plainToInstance, Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsString,
  Matches,
  Max,
  Min,
  MinLength,
  validateSync,
  type ValidationArguments,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
  Validate,
} from 'class-validator';

const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'];

/** `'true'`/`'false'` become booleans; anything else is left for `@IsBoolean` to reject. */
const toBoolean = ({ value }: { value: unknown }): unknown =>
  value === 'true' ? true : value === 'false' ? false : value;

/** The internal key is held only by the Payment Service, so it must not equal the public one. */
@ValidatorConstraint({ name: 'differsFromPublicKey', async: false })
class DiffersFromPublicKey implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments): boolean {
    return value !== (args.object as EnvironmentVariables).PUBLIC_API_KEY_LEDGER;
  }

  defaultMessage(): string {
    return 'INTERNAL_API_KEY_LEDGER must differ from PUBLIC_API_KEY_LEDGER';
  }
}

export class EnvironmentVariables {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(65535)
  PORT: number = 3003;

  @IsString()
  @IsNotEmpty()
  @Matches(/[?&]schema=ledger(&|$)/, { message: 'DATABASE_URL must contain ?schema=ledger' })
  DATABASE_URL!: string;

  @IsString()
  @MinLength(32)
  PUBLIC_API_KEY_LEDGER!: string;

  @IsString()
  @MinLength(32)
  @Validate(DiffersFromPublicKey)
  INTERNAL_API_KEY_LEDGER!: string;

  @Transform(toBoolean)
  @IsBoolean()
  SWAGGER_ENABLED: boolean = false;

  @IsIn(LOG_LEVELS)
  LOG_LEVEL: string = 'info';
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
