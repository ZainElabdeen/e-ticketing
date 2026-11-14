import { FixedWindowStorage } from './fixed-window.storage';

describe('FixedWindowStorage', () => {
  let storage: FixedWindowStorage;

  beforeEach(() => {
    jest.useFakeTimers();
    storage = new FixedWindowStorage();
  });

  afterEach(() => {
    storage.onApplicationShutdown();
    jest.useRealTimers();
  });

  it('opens a window at the first hit and counts up to the limit', async () => {
    const first = await storage.increment('k', 60_000, 2);
    expect(first).toMatchObject({ totalHits: 1, isBlocked: false, timeToExpire: 60 });
    jest.advanceTimersByTime(10_000);
    const second = await storage.increment('k', 60_000, 2);
    expect(second).toMatchObject({ totalHits: 2, isBlocked: false, timeToExpire: 50 });
  });

  it('does not count a blocked hit, so the window is not extended', async () => {
    await storage.increment('k', 60_000, 1);
    jest.advanceTimersByTime(30_000);
    const blocked = await storage.increment('k', 60_000, 1);
    expect(blocked).toMatchObject({ isBlocked: true, timeToBlockExpire: 30 });
    const again = await storage.increment('k', 60_000, 1);
    expect(again.totalHits).toBe(2); // the stored count stays 1; a blocked hit reports +1
    jest.advanceTimersByTime(30_000);
    expect(await storage.increment('k', 60_000, 1)).toMatchObject({ isBlocked: false });
  });

  it('resets after the ttl', async () => {
    await storage.increment('k', 1000, 1);
    expect((await storage.increment('k', 1000, 1)).isBlocked).toBe(true);
    jest.setSystemTime(Date.now() + 1001);
    expect(await storage.increment('k', 1000, 1)).toMatchObject({ totalHits: 1, isBlocked: false });
  });

  it('sweeps expired windows on its interval', async () => {
    await storage.increment('a', 1000, 5);
    const windows = (storage as unknown as { windows: Map<string, unknown> }).windows;
    expect(windows.size).toBe(1);
    jest.advanceTimersByTime(2100);
    expect(windows.size).toBe(0);
  });

  it('shutdown clears the interval and the windows', async () => {
    await storage.increment('a', 1000, 5);
    expect(jest.getTimerCount()).toBe(1);
    storage.onApplicationShutdown();
    expect(jest.getTimerCount()).toBe(0);
    expect((storage as unknown as { windows: Map<string, unknown> }).windows.size).toBe(0);
  });
});
