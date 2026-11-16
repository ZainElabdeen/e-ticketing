import { useDocumentTitle } from '../app/useDocumentTitle';
import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Link, Navigate } from 'react-router';
import { z } from 'zod';
import { ApiError, messageFor } from '../api/errors';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { useAuth } from './AuthProvider';
import { PasswordField } from './PasswordField';
import styles from './LoginPage.module.css';

const MAX_BYTES = 72; // bcrypt limit

const schema = z.object({
  email: z.string().trim().email('Enter a valid email address'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password is too long')
    .refine((p) => new TextEncoder().encode(p).length <= MAX_BYTES, 'Password is too long'),
});
type Values = z.input<typeof schema>;

function loginMessage(e: unknown): string {
  if (e instanceof ApiError && e.code === 'INVALID_CREDENTIALS') {
    return 'Email or password is incorrect';
  }
  return messageFor(e);
}

export function LoginPage(): ReactElement {
  useDocumentTitle('Sign in');
  const { token, login, notice, clearNotice } = useAuth();
  // Show the expiry notice once: keep it locally, then clear it from the auth state.
  const [shownNotice] = useState(notice);
  useEffect(() => {
    clearNotice();
  }, [clearNotice]);
  const [failure, setFailure] = useState<string | null>(null);
  // A ref, not isSubmitting alone: a second submit can land before React re-renders.
  const signingIn = useRef(false);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values, unknown, z.output<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });

  if (token) return <Navigate to="/backoffice" replace />;

  const field = (name: keyof Values, label: string, type: string, autoComplete: string) => {
    const message = errors[name]?.message;
    return (
      <div className={styles.field}>
        <label htmlFor={`login-${name}`}>{label}</label>
        <input
          id={`login-${name}`}
          type={type}
          autoComplete={autoComplete}
          spellCheck={false}
          aria-invalid={message ? true : undefined}
          aria-describedby={message ? `login-${name}-error` : undefined}
          {...register(name)}
        />
        {message ? (
          <p id={`login-${name}-error`} role="alert" className={styles.error}>
            {message}
          </p>
        ) : null}
      </div>
    );
  };

  return (
    <section className={styles.page}>
      <h1>Sign in</h1>
      {shownNotice ? <Banner tone="info">{shownNotice}</Banner> : null}
      {failure ? <Banner>{failure}</Banner> : null}
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          void handleSubmit(async (v) => {
            if (signingIn.current) return;
            signingIn.current = true;
            setFailure(null);
            try {
              await login(v.email, v.password);
            } catch (err) {
              signingIn.current = false;
              setFailure(loginMessage(err));
            }
          })(e);
        }}
      >
        {field('email', 'Email', 'email', 'username')}
        <PasswordField
          label="Password"
          autoComplete="current-password"
          message={errors.password?.message}
          registration={register('password')}
        />
        <Button type="submit" disabled={isSubmitting} className={styles.submit}>
          Sign in
        </Button>
      </form>
      <Link to="/" className={styles.back}>
        Back to shop
      </Link>
    </section>
  );
}
