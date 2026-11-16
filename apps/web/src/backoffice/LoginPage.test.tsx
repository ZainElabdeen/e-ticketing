import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, describe, expect, it } from 'vitest';
import { renderWithApp, stubFetch, type StubRoute } from '../test/render';
import { LoginPage } from './LoginPage';
import { clearSession, saveSession } from './session';

const login = (status: number, body: unknown): StubRoute => ({
  method: 'POST',
  path: '/v1/auth/login',
  status,
  body,
});

function renderLogin(routes: StubRoute[]) {
  const fetch = stubFetch(routes);
  const view = renderWithApp(
    <Routes>
      <Route path="/backoffice/login" element={<LoginPage />} />
      <Route path="/backoffice" element={<h1>Backoffice home</h1>} />
    </Routes>,
    { fetch, route: '/backoffice/login' },
  );
  return { ...view, fetch };
}

describe('LoginPage', () => {
  afterEach(() => {
    clearSession();
  });

  it('shows and hides the typed password', async () => {
    const { user } = renderLogin([]);
    const input = screen.getByLabelText('Password');
    await user.type(input, 'correct-horse');
    expect(input).toHaveAttribute('type', 'password');
    await user.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
    const hide = screen.getByRole('button', { name: 'Hide password' });
    expect(hide).toHaveAttribute('aria-pressed', 'true');
    await user.click(hide);
    expect(input).toHaveAttribute('type', 'password');
    expect(screen.getByRole('button', { name: 'Show password' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('signs in and opens the backoffice', async () => {
    const { user, fetch } = renderLogin([login(200, { accessToken: 'jwt-1', expiresIn: 3600 })]);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Backoffice home')).toBeInTheDocument();
    expect(await fetch.calls[0]!.json()).toEqual({
      email: 'admin@example.com',
      password: 'correct-horse',
    });
    const stored = JSON.parse(
      window.sessionStorage.getItem('eticket.backoffice.session') ?? '{}',
    ) as { token?: string };
    expect(stored.token).toBe('jwt-1');
    expect(window.sessionStorage.getItem('eticket.backoffice.session')).not.toContain(
      'correct-horse',
    );
  });

  it('links back to the shop', () => {
    renderLogin([]);
    expect(screen.getByRole('link', { name: 'Back to shop' })).toHaveAttribute('href', '/');
  });

  it('wrong password shows a clear error', async () => {
    const { user } = renderLogin([
      login(401, { code: 'INVALID_CREDENTIALS', message: 'nope', correlationId: 'c' }),
    ]);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Email or password is incorrect')).toBeInTheDocument();
    expect(window.sessionStorage.getItem('eticket.backoffice.session')).toBeNull();
  });

  it('shows the rate-limit banner', async () => {
    const { user } = renderLogin([login(429, { code: 'RATE_LIMITED', message: 'slow' })]);
    await user.type(screen.getByLabelText('Email'), 'admin@example.com');
    await user.type(screen.getByLabelText('Password'), 'correct-horse');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Too many requests, try again shortly')).toBeInTheDocument();
  });

  it('password over 72 bytes is rejected before sending', async () => {
    const { fetch } = renderLogin([login(200, { accessToken: 'x', expiresIn: 3600 })]);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'é'.repeat(37) } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Password is too long')).toBeInTheDocument();
    await waitFor(() => expect(fetch.calls).toHaveLength(0));
  });

  it('rejects an invalid email before sending', async () => {
    const { fetch } = renderLogin([]);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid email address')).toBeInTheDocument();
    expect(fetch.calls).toHaveLength(0);
  });

  it('a double click on Sign in sends one request', async () => {
    const { fetch } = renderLogin([login(200, { accessToken: 'jwt-1', expiresIn: 3600 })]);
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'admin@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct-horse' } });
    const button = screen.getByRole('button', { name: 'Sign in' });
    fireEvent.click(button);
    fireEvent.click(button);
    expect(await screen.findByText('Backoffice home')).toBeInTheDocument();
    expect(fetch.calls).toHaveLength(1);
  });

  it('redirects to the backoffice when a session already exists', async () => {
    saveSession('jwt', 3600);
    renderLogin([]);
    expect(await screen.findByText('Backoffice home')).toBeInTheDocument();
  });

  it('sets the document title', () => {
    renderLogin([]);
    expect(document.title).toBe('Sign in · E-Ticket');
  });
});
