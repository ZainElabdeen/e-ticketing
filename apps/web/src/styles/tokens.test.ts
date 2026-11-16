import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(resolve(__dirname, 'tokens.css'), 'utf8');

function token(name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`, 'u').exec(css);
  if (!m?.[1]) throw new Error(`token --${name} not found`);
  return m[1];
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe('colour tokens meet WCAG AA (4.5:1)', () => {
  for (const fg of ['ink', 'ink-muted', 'stamp', 'ok']) {
    for (const bg of ['paper', 'card']) {
      it(`--${fg} on --${bg}`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  it('--card text on --stamp', () => {
    expect(contrast(token('card'), token('stamp'))).toBeGreaterThanOrEqual(4.5);
  });

  for (const fg of ['tier-gold-text', 'tier-premium-text', 'tier-vip-text']) {
    it(`--${fg} on --card`, () => {
      expect(contrast(token(fg), token('card'))).toBeGreaterThanOrEqual(4.5);
    });
  }
  for (const fg of ['c-ink', 'c-muted']) {
    for (const bg of ['c-canvas', 'c-surface']) {
      it(`--${fg} on --${bg}`, () => {
        expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
      });
    }
  }
  const pairs: [string, string][] = [
    ['c-on-accent', 'c-accent'],
    ['c-accent', 'c-accent-soft'],
    ['c-accent', 'c-canvas'],
    ['c-accent', 'c-surface'],
    ['stamp', 'c-surface'],
    ['c-ok-fg', 'c-ok-bg'],
    ['card', 'ink'],
  ];
  for (const [fg, bg] of pairs) {
    it(`--${fg} on --${bg}`, () => {
      expect(contrast(token(fg), token(bg))).toBeGreaterThanOrEqual(4.5);
    });
  }
});
