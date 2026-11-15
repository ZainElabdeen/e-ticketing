const NBSP = '\u00A0';

/** Formats integer minor units (1 AED = 100 fils) as e.g. "AED 1,234.50". */
export function formatMinor(minor: number, currency: string): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(minor);
  const whole = Math.trunc(abs / 100);
  const fraction = String(abs % 100).padStart(2, '0');
  const grouped = new Intl.NumberFormat('en', { maximumFractionDigits: 0 }).format(whole);
  return `${currency}${NBSP}${sign}${grouped}.${fraction}`;
}

export function sumMinor(lines: Array<{ priceMinor: number; quantity: number }>): number {
  return lines.reduce((total, line) => total + line.priceMinor * line.quantity, 0);
}
