import { toTicketTypeView } from './ticket-type.view';

describe('toTicketTypeView', () => {
  it('computes available as quota - sold - reserved and converts money', () => {
    const view = toTicketTypeView({
      code: 'GOLD',
      name: 'Gold',
      priceMinor: 10000n,
      currency: 'AED',
      quota: 100,
      sold: 7,
      reserved: 3,
    });
    expect(view).toEqual({
      code: 'GOLD',
      name: 'Gold',
      priceMinor: 10000,
      currency: 'AED',
      quota: 100,
      sold: 7,
      reserved: 3,
      available: 90,
    });
  });
});
