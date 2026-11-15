import { afterEach, describe, expect, it, vi } from 'vitest';
import { forgetPayment, recallPayment, rememberPayment } from './paymentMemory';

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

describe('paymentMemory', () => {
  it('round-trips and forgets', () => {
    rememberPayment('o-1', { paymentId: 'p-1', method: 'QR' });
    expect(recallPayment('o-1')).toEqual({ paymentId: 'p-1', method: 'QR' });
    forgetPayment('o-1');
    expect(recallPayment('o-1')).toBeNull();
  });
  it('returns null for an unknown order and corrupted JSON', () => {
    expect(recallPayment('nope')).toBeNull();
    window.sessionStorage.setItem('eticket.payment.o-2', '{oops');
    expect(recallPayment('o-2')).toBeNull();
    window.sessionStorage.setItem('eticket.payment.o-3', '{"paymentId":1}');
    expect(recallPayment('o-3')).toBeNull();
  });
  it('does not crash when storage throws', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(() => rememberPayment('o-1', { paymentId: 'p', method: 'CARD' })).not.toThrow();
    expect(recallPayment('o-1')).toBeNull();
  });
});
