import { safeSession } from './storage';

describe('safeSession', () => {
  it('round-trips a value', () => {
    safeSession.set('k', 'v');
    expect(safeSession.get('k')).toBe('v');
    safeSession.remove('k');
    expect(safeSession.get('k')).toBeNull();
  });

  it('never throws when sessionStorage is unavailable', () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(safeSession.get('k')).toBeNull();
    spy.mockRestore();
  });
});
