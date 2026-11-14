import { BadRequestException } from '@nestjs/common';
import { IsInt, IsString } from 'class-validator';
import { createValidationPipe } from './validation';

class Dto {
  @IsString() code!: string;
  @IsInt() quantity!: number;
}

const meta = { type: 'body' as const, metatype: Dto };

describe('createValidationPipe', () => {
  const pipe = createValidationPipe();

  it('accepts a valid body', async () => {
    await expect(pipe.transform({ code: 'GOLD', quantity: 2 }, meta)).resolves.toMatchObject({
      quantity: 2,
    });
  });

  it('does not coerce "2" into a quantity', async () => {
    await expect(pipe.transform({ code: 'GOLD', quantity: '2' }, meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects unknown properties', async () => {
    await expect(
      pipe.transform({ code: 'GOLD', quantity: 2, extra: 1 }, meta),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
