import { ValidationPipe } from '@nestjs/common';

/**
 * No enableImplicitConversion: `"2"` must not become a quantity of 2.
 * Failures surface as BadRequestException, which the envelope filter maps.
 */
export function createValidationPipe(): ValidationPipe {
  return new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
}
