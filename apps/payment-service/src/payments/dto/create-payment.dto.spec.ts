import { BadRequestException } from '@nestjs/common';
import { createValidationPipe } from '@eticket/nest-common';
import { CreatePaymentDto } from './create-payment.dto';

const pipe = createValidationPipe();
const meta = { type: 'body' as const, metatype: CreatePaymentDto };
const ORDER_ID = '0b1f6a3e-2f7c-4a39-9d3c-3f6c7c1d2a10';
const PAN = '4242424242424242';
const card = { number: PAN, expMonth: 12, expYear: 2030, cvc: '987', holder: 'Jane Doe' };

async function messageOf(body: unknown): Promise<string> {
  try {
    await pipe.transform(body, meta);
  } catch (e) {
    expect(e).toBeInstanceOf(BadRequestException);
    return JSON.stringify((e as BadRequestException).getResponse());
  }
  throw new Error('did not throw');
}

describe('CreatePaymentDto', () => {
  it('accepts CARD with a card', async () => {
    await expect(
      pipe.transform({ orderId: ORDER_ID, method: 'CARD', card }, meta),
    ).resolves.toBeDefined();
  });
  it('accepts QR without a card', async () => {
    await expect(pipe.transform({ orderId: ORDER_ID, method: 'QR' }, meta)).resolves.toBeDefined();
  });
  it('rejects CARD without a card', async () => {
    expect(await messageOf({ orderId: ORDER_ID, method: 'CARD' })).toContain(
      'card is required for CARD',
    );
  });
  it('rejects QR with a card', async () => {
    expect(await messageOf({ orderId: ORDER_ID, method: 'QR', card })).toContain(
      'card must be absent for QR',
    );
  });
  it('rejects a non-UUID order and an unknown method', async () => {
    await messageOf({ orderId: 'x', method: 'CARD', card });
    await messageOf({ orderId: ORDER_ID, method: 'WALLET' });
  });
  it('rejects bad card fields without echoing PAN or CVC', async () => {
    const msg = await messageOf({
      orderId: ORDER_ID,
      method: 'CARD',
      card: { number: '4242-4242-4242-4242', expMonth: 13, expYear: 1999, cvc: '5731x', holder: '' },
    });
    expect(msg).not.toContain('4242-4242-4242-4242');
    expect(msg).not.toContain('5731');
  });
  it('does not echo a valid-shaped PAN when another field fails', async () => {
    const msg = await messageOf({
      orderId: ORDER_ID,
      method: 'CARD',
      card: { ...card, cvc: 'abc' },
    });
    expect(msg).not.toContain(PAN);
    expect(msg).not.toContain('abc"');
  });
  it('does not Luhn-check in the DTO', async () => {
    await expect(
      pipe.transform(
        { orderId: ORDER_ID, method: 'CARD', card: { ...card, number: '4242424242424241' } },
        meta,
      ),
    ).resolves.toBeDefined();
  });
});
