import {
  BadRequestException,
  Injectable,
  createParamDecorator,
  type ExecutionContext,
  type PipeTransform,
} from '@nestjs/common';

/** The raw `Idempotency-Key` header; `@Headers` takes no pipes, a custom decorator does. */
export const IdempotencyKeyHeader = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string | undefined => {
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string | undefined> }>();
    return req.headers['idempotency-key'];
  },
);

/** The `Idempotency-Key` header: required, 8 to 128 characters (ADR-0005). */
@Injectable()
export class IdempotencyKeyPipe implements PipeTransform<string | undefined, string> {
  transform(value: string | undefined): string {
    if (typeof value !== 'string' || value.length < 8 || value.length > 128) {
      throw new BadRequestException(
        'Idempotency-Key header is required and must be 8 to 128 characters',
      );
    }
    return value;
  }
}
