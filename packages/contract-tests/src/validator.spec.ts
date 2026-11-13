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

describe('ContractValidator.validateSchema', () => {
  const v = ContractValidator.load('ledger-service');
  const posting = {
    transactionId: '2b7e1a9c-3d4f-4a5b-8c6d-7e8f9a0b1c2d',
    postingType: 'TICKET_SALE',
    orderId: '6a1f0e9e-1c2b-4f3a-9d4e-5f6a7b8c9d0e',
    paymentReference: 'PAY-20261113-7F3K9Q',
    amountMinor: 70000,
    currency: 'AED',
  };

  it('accepts a value that matches the named schema', () =>
    expect(() => v.validateSchema('PostingRequest', posting)).not.toThrow());

  it('rejects an extra property and names it', () =>
    expect(() => v.validateSchema('PostingRequest', { ...posting, cardNumber: '4' })).toThrow(
      /PostingRequest.*additional/i,
    ));

  it('rejects a wrong type', () =>
    expect(() => v.validateSchema('PostingRequest', { ...posting, amountMinor: '1' })).toThrow(
      /amountMinor/,
    ));

  it('throws on an unknown schema name', () =>
    expect(() => v.validateSchema('Nope', {})).toThrow(/Nope/));

  it('loads the payment-service contract too', () =>
    expect(() => ContractValidator.load('payment-service')).not.toThrow());
});
