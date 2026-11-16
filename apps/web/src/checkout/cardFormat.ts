const digitsOf = (raw: string): string => raw.replace(/\D/gu, '');

/** Digits only, at most 16, grouped in fours with single spaces. */
export function formatCardNumber(raw: string): string {
  return (
    digitsOf(raw)
      .slice(0, 16)
      .match(/\d{1,4}/gu) ?? []
  ).join(' ');
}

/**
 * Digits only as MM/YY. A first digit of 2-9 becomes `0d/`; a month above 12 or 00 drops its
 * second digit. `previous` detects backspace on the slash: it removes the slash and the last
 * month digit (`12/` then backspace gives `1`).
 */
export function formatExpiry(raw: string, previous: string): string {
  if (previous.endsWith('/') && raw === previous.slice(0, -1)) return raw.slice(0, -1);
  let digits = digitsOf(raw).slice(0, 4);
  if (/^[2-9]/u.test(digits)) digits = `0${digits}`.slice(0, 4);
  if (digits.length < 2) return digits;
  const month = Number(digits.slice(0, 2));
  if (month < 1 || month > 12) return digits.slice(0, 1);
  return `${digits.slice(0, 2)}/${digits.slice(2)}`;
}

/** Digits only, at most 4. */
export function formatCvc(raw: string): string {
  return digitsOf(raw).slice(0, 4);
}
