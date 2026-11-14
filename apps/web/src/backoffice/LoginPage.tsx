import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactElement } from 'react';
import { useForm } from 'react-hook-form';
import { Navigate } from 'react-router';
import { z } from 'zod';
import { ApiError } from '../api/errors';
import { Banner } from '../ui/Banner';
import { Button } from '../ui/Button';
import { useAuth } from './AuthProvider';
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

const GENERIC = 'Something went wrong on our side. Try again.';

function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'INVALID_CREDENTIALS') return 'Email or password is incorrect';
    if (e.code === 'RATE_LIMITED') return 'Too many requests, try again shortly';
  }
  return GENERIC;
}

export function LoginPage(): ReactElement {
  const { token, login, notice } = useAuth();
  const [failure, setFailure] = useState<string | null>(null);
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
      {notice ? <Banner tone="info">{notice}</Banner> : null}
      {failure ? <Banner>{failure}</Banner> : null}
      <form
        className={styles.form}
        noValidate
        onSubmit={(e) => {
          void handleSubmit(async (v) => {
            setFailure(null);
            try {
              await login(v.email, v.password);
            } catch (err) {
              setFailure(messageFor(err));
            }
          })(e);
        }}
      >
        {field('email', 'Email', 'email', 'username')}
        {field('password', 'Password', 'password', 'current-password')}
        <Button type="submit" disabled={isSubmitting} className={styles.submit}>
          Sign in
        </Button>
      </form>
    </section>
  );
}
