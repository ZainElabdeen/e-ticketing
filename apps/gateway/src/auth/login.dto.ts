import { Transform } from 'class-transformer';
import {
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/** bcrypt ignores everything past byte 72, so a longer password would be silently truncated. */
export const BCRYPT_MAX_BYTES = 72;

function MaxUtf8Bytes(max: number, options?: ValidationOptions) {
  return (target: object, propertyKey: string): void => {
    registerDecorator({
      name: 'maxUtf8Bytes',
      target: target.constructor,
      propertyName: propertyKey,
      options,
      constraints: [max],
      validator: {
        validate: (value: unknown) => typeof value === 'string' && Buffer.byteLength(value) <= max,
        defaultMessage: () => `password must be at most ${max} bytes in UTF-8`,
      },
    });
  };
}

export class LoginDto {
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  @MaxUtf8Bytes(BCRYPT_MAX_BYTES)
  password!: string;
}
