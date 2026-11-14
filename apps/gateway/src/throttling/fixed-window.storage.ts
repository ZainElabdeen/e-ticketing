import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { ThrottlerStorage } from '@nestjs/throttler';

type StorageRecord = Awaited<ReturnType<ThrottlerStorage['increment']>>;

interface Window {
  hits: number;
  resetAt: number;
}

/**
 * In-memory fixed-window counters (spec §7, single replica per spec §10).
 * The window opens at the first hit and resets as a whole. A hit over the
 * limit is rejected without being counted, so it never extends the window.
 */
@Injectable()
export class FixedWindowStorage implements ThrottlerStorage, OnApplicationShutdown {
  private readonly windows = new Map<string, Window>();
  private sweeper: NodeJS.Timeout | undefined;

  increment(key: string, ttl: number, limit: number): Promise<StorageRecord> {
    this.ensureSweeper(ttl);
    const now = Date.now();
    let win = this.windows.get(key);
    if (!win || win.resetAt <= now) {
      win = { hits: 0, resetAt: now + ttl };
      this.windows.set(key, win);
    }
    const isBlocked = win.hits >= limit;
    if (!isBlocked) win.hits += 1;
    // Whole seconds until the window resets, never below 1.
    const secondsLeft = Math.max(1, Math.ceil((win.resetAt - now) / 1000));
    return Promise.resolve({
      totalHits: isBlocked ? win.hits + 1 : win.hits,
      timeToExpire: secondsLeft,
      isBlocked,
      timeToBlockExpire: isBlocked ? secondsLeft : 0,
    });
  }

  private ensureSweeper(ttl: number): void {
    if (this.sweeper) return;
    this.sweeper = setInterval(() => {
      const now = Date.now();
      for (const [key, win] of this.windows) {
        if (win.resetAt <= now) this.windows.delete(key);
      }
    }, ttl);
    this.sweeper.unref();
  }

  onApplicationShutdown(): void {
    if (this.sweeper) clearInterval(this.sweeper);
    this.sweeper = undefined;
    this.windows.clear();
  }
}
