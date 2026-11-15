import { createHash } from 'node:crypto';
import type { CreatePaymentInput } from './types';

/** The hashed shape: the PAN and CVC are dropped, only the last four digits stay. */
export function hashInput(input: CreatePaymentInput): object {
  const base = { orderId: input.orderId, method: input.method };
  if (!input.card) return base;
  const { number, expMonth, expYear, holder } = input.card;
  return { ...base, card: { last4: number.slice(-4), expMonth, expYear, holder } };
}

/** Sorted keys at every depth, no whitespace. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort(byCodeUnit)) {
      out[key] = sortKeys((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}

/**
 * Plain UTF-16 code-unit order, the same order as a bare `sort()`. Stored request
 * hashes depend on it, so it must stay locale-independent (no `localeCompare`).
 */
function byCodeUnit(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

export function requestHash(input: CreatePaymentInput): string {
  return createHash('sha256')
    .update(canonicalJson(hashInput(input)))
    .digest('hex');
}
