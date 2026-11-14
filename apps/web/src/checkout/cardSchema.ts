import { z } from 'zod';
import type { CardDetails } from '../api/types';
import { luhnValid } from './luhn';

export type CardFormValues = { holder: string; number: string; expiry: string; cvc: string };

/** Card form validation. Output is the contract `CardDetails`; `now` is injectable for tests. */
export function makeCardSchema(now: () => Date): z.ZodType<CardDetails, CardFormValues> {
  return z
    .object({
      holder: z.string().trim().min(1, 'Enter the name on the card').max(100),
      number: z
        .string()
        .transform((v) => v.replace(/[\s-]/gu, ''))
        .refine((v) => /^\d{12,19}$/u.test(v) && luhnValid(v), 'Check the card number'),
      expiry: z
        .string()
        .trim()
        .regex(/^(0[1-9]|1[0-2])\/\d{2}$/u, 'Use the format MM/YY'),
      cvc: z
        .string()
        .trim()
        .regex(/^\d{3,4}$/u, 'Enter the 3 or 4 digit security code'),
    })
    .transform((v, ctx): CardDetails => {
      const [mm, yy] = v.expiry.split('/') as [string, string];
      const expMonth = Number(mm);
      const expYear = 2000 + Number(yy);
      const today = now();
      if (expYear * 12 + expMonth < today.getFullYear() * 12 + today.getMonth() + 1) {
        ctx.addIssue({ code: 'custom', path: ['expiry'], message: 'Card has expired' });
        return z.NEVER;
      }
      return { number: v.number, expMonth, expYear, cvc: v.cvc, holder: v.holder };
    });
}
