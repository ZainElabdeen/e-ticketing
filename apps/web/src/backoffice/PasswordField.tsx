import { useState, type ReactElement } from 'react';
import type { UseFormRegisterReturn } from 'react-hook-form';
import styles from './LoginPage.module.css';

function EyeIcon({ off }: { off: boolean }): ReactElement {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

export type PasswordFieldProps = {
  label: string;
  autoComplete: string;
  message: string | undefined;
  registration: UseFormRegisterReturn;
};

/** Password input with a show/hide toggle inside the field. */
export function PasswordField(props: PasswordFieldProps): ReactElement {
  const { label, autoComplete, message, registration } = props;
  const [shown, setShown] = useState(false);
  const id = `login-${registration.name}`;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.control}>
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `${id}-error` : undefined}
          {...registration}
        />
        <button
          type="button"
          className={styles.toggle}
          aria-label={shown ? 'Hide password' : 'Show password'}
          aria-pressed={shown}
          onClick={() => setShown((v) => !v)}
        >
          <EyeIcon off={shown} />
        </button>
      </div>
      {message ? (
        <p id={`${id}-error`} role="alert" className={styles.error}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
