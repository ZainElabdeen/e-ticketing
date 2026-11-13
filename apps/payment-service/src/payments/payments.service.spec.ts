import { randomUUID } from 'node:crypto';
import type { Clock } from '../common/clock';
import type { TicketClient, TicketOrder } from '../downstream/ticket.client';
import { HandlerRegistry } from './handlers/handler-registry';
import { QrHandler } from './handlers/qr.handler';
import type { PaymentsRepository } from './payments.repository';
import { PaymentsService } from './payments.service';

const order: TicketOrder = {
  id: randomUUID(),
  status: 'PENDING',
  totalMinor: 70000,
  currency: 'AED',
  expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
};
const liveViolation = Object.assign(new Error('duplicate key'), {
  code: '23505',
  constraint: 'payments_one_live_per_order',
});

function build(live: Array<'PENDING' | 'SUCCEEDED' | null>, createResults: unknown[] = []) {
  const createWithKey = jest.fn();
  for (let i = 0; i < 5; i++) {
    const next = createResults[i];
    if (next === undefined) createWithKey.mockRejectedValueOnce(liveViolation);
    else createWithKey.mockResolvedValueOnce(next);
  }
  const liveStatusFor = jest.fn();
  for (const l of live) liveStatusFor.mockResolvedValueOnce(l);
  const getOrder = jest.fn().mockResolvedValue(order);
  const repo = {
    findKey: jest.fn().mockResolvedValue(null),
    createWithKey,
    liveStatusFor,
  } as unknown as PaymentsRepository;
  const clock: Clock = { now: () => new Date() };
  const service = new PaymentsService(
    repo,
    new HandlerRegistry([new QrHandler(8)]),
    { getOrder } as unknown as TicketClient,
    clock,
  );
  return { service, createWithKey, liveStatusFor, getOrder };
}

const input = { orderId: order.id, method: 'QR' as const };
const create = (s: PaymentsService) => s.create(input, 'key-0123456789', 'corr-1');

describe('PaymentsService.create after a live-payment conflict', () => {
  it.each([
    ['PENDING', 'PAYMENT_IN_PROGRESS'],
    ['SUCCEEDED', 'ORDER_ALREADY_PAID'],
  ] as const)('maps a live %s payment to %s', async (live, code) => {
    const { service, createWithKey } = build([live]);
    await expect(create(service)).rejects.toMatchObject({ code });
    expect(createWithKey).toHaveBeenCalledTimes(1);
  });

  it('retries once, from the order read, when the live payment vanished', async () => {
    const view = { id: 'p1' };
    const { service, createWithKey, getOrder } = build([null], [undefined, { kind: 'CREATED', view }]);
    await expect(create(service)).resolves.toEqual({ view, replayed: false });
    expect(createWithKey).toHaveBeenCalledTimes(2);
    expect(getOrder).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['PENDING', 'PAYMENT_IN_PROGRESS'],
    ['SUCCEEDED', 'ORDER_ALREADY_PAID'],
    [null, 'PAYMENT_IN_PROGRESS'],
  ] as const)('after the retry also conflicts, %s maps to %s', async (second, code) => {
    const { service, createWithKey } = build([null, second]);
    await expect(create(service)).rejects.toMatchObject({ code });
    expect(createWithKey).toHaveBeenCalledTimes(2);
  });
});
