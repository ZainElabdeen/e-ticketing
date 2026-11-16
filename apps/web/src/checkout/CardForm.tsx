import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo, useState, type ChangeEvent, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import type { CardDetails } from '../api/types';
import { Button } from '../ui/Button';
import { StickyBar } from '../ui/StickyBar';
import { formatCardNumber, formatCvc, formatExpiry } from './cardFormat';
import { makeCardSchema, type CardFormValues } from './cardSchema';
import styles from './CardForm.module.css';

export type CardFormProps = {
  payLabel: string;
  disabled: boolean;
  /** Called with validated card details. `setNumberError` shows a server rejection inline. */
  onSubmit: (card: CardDetails, setNumberError: (message: string) => void) => Promise<void>;
  /** Called whenever the user edits a field (the page uses it to start a new idempotency key). */
  onEdit: () => void;
};

export function CardForm({ payLabel, disabled, onSubmit, onEdit }: CardFormProps): ReactElement {
  const resolver = useMemo(() => zodResolver(makeCardSchema(() => new Date())), []);
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    formState: { errors },
  } = useForm<CardFormValues, unknown, CardDetails>({
    resolver,
    defaultValues: { holder: '', number: '', expiry: '', cvc: '' },
  });

  // The expiry as last shown: tells backspace on the slash apart from typing.
  const [shownExpiry, setShownExpiry] = useState('');
  const format = (name: keyof CardFormValues, raw: string): string => {
    if (name === 'number') return formatCardNumber(raw);
    if (name === 'cvc') return formatCvc(raw);
    if (name === 'expiry') {
      const next = formatExpiry(raw, shownExpiry);
      setShownExpiry(next);
      return next;
    }
    return raw;
  };

  const field = (
    name: keyof CardFormValues,
    label: string,
    extra: {
      autoComplete: string;
      inputMode?: 'numeric';
      placeholder?: string;
    },
  ): ReactElement => {
    const message = errors[name]?.message;
    return (
      <div className={`${styles.field} ${styles[name]}`}>
        <label htmlFor={`card-${name}`}>{label}</label>
        <input
          id={`card-${name}`}
          type="text"
          spellCheck={false}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `card-${name}-error` : undefined}
          {...extra}
          {...register(name, {
            onChange: (e: ChangeEvent<HTMLInputElement>) => {
              setValue(name, format(name, e.target.value), { shouldValidate: false });
              onEdit();
            },
          })}
        />
        {message ? (
          <p id={`card-${name}-error`} role="alert" className={styles.error}>
            {message}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <form
      className={styles.form}
      noValidate
      onSubmit={(e) => {
        void handleSubmit((card) => onSubmit(card, (message) => setError('number', { message })))(
          e,
        );
      }}
    >
      {field('holder', 'Name on card', { autoComplete: 'cc-name' })}
      {field('number', 'Card number', {
        autoComplete: 'cc-number',
        inputMode: 'numeric',
        placeholder: '4242 4242 4242 4242',
      })}
      {field('expiry', 'Expiry (MM/YY)', {
        autoComplete: 'cc-exp',
        inputMode: 'numeric',
        placeholder: 'MM/YY',
      })}
      {field('cvc', 'Security code', {
        autoComplete: 'cc-csc',
        inputMode: 'numeric',
      })}
      <StickyBar>
        <Button type="submit" disabled={disabled}>
          {payLabel}
        </Button>
      </StickyBar>
    </form>
  );
}
