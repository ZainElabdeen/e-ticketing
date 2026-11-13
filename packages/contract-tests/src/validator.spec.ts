import { ContractValidator } from './validator';

describe('ContractValidator', () => {
  const v = ContractValidator.load('ticket-service');
  const ticketType = {
    code: 'GOLD',
    name: 'Gold',
    priceMinor: 10000,
    currency: 'AED',
    quota: 100,
    sold: 0,
    reserved: 0,
    available: 100,
  };
  const pendingOrder = {
    id: '3f0c2a52-6f43-4a8c-9d5b-0a9f4f7a1c11',
    status: 'PENDING',
    items: [
      {
        ticketTypeCode: 'GOLD',
        quantity: 2,
        unitPriceMinor: 10000,
        lineTotalMinor: 20000,
      },
    ],
    totalMinor: 20000,
    currency: 'AED',
    createdAt: '2026-11-13T10:00:00.000Z',
    expiresAt: '2026-11-13T10:15:00.000Z',
    confirmedAt: null,
    paidTransactionId: null,
  };

  it('accepts a valid listTicketTypes 200 body', () =>
    expect(() => v.assertResponse('listTicketTypes', 200, { data: [ticketType] })).not.toThrow());

  it('rejects a missing required field', () =>
    expect(() =>
      v.assertResponse('listTicketTypes', 200, {
        data: [{ ...ticketType, available: undefined }],
      }),
    ).toThrow(/available/));

  it('rejects a string where an integer is required', () =>
    expect(() =>
      v.assertResponse('listTicketTypes', 200, {
        data: [{ ...ticketType, priceMinor: '10000' }],
      }),
    ).toThrow(/priceMinor/));

  it('accepts null for nullable confirmedAt', () =>
    expect(() => v.assertResponse('getOrder', 200, pendingOrder)).not.toThrow());

  it('rejects a status the operation does not document', () =>
    expect(() => v.assertResponse('getOrder', 500, {})).toThrow(/not documented/));

  it('rejects an error body without correlationId', () =>
    expect(() =>
      v.assertResponse('getOrder', 404, {
        statusCode: 404,
        code: 'NOT_FOUND',
        message: 'x',
      }),
    ).toThrow(/correlationId/));

  it('throws on an unknown operationId', () =>
    expect(() => v.assertResponse('nope', 200, {})).toThrow(/nope/));
});
