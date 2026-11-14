import { useEffect, type ReactElement, type ReactNode } from 'react';
import { Navigate } from 'react-router';
import { useAuth } from './AuthProvider';
import { loadSession } from './session';

const CHECK_EVERY_MS = 30_000;

export function RequireAuth({ children }: { children: ReactNode }): ReactElement | null {
  const { token, logout } = useAuth();
  // Checked on every render; loadSession clears an expired session.
  const expired = token !== null && loadSession() === null;

  useEffect(() => {
    if (expired) logout('expired');
  }, [expired, logout]);

  useEffect(() => {
    if (token === null) return undefined;
    const id = setInterval(() => {
      if (loadSession() === null) logout('expired');
    }, CHECK_EVERY_MS);
    return () => clearInterval(id);
  }, [token, logout]);

  if (token === null) return <Navigate to="/backoffice/login" replace />;
  if (expired) return null;
  return <>{children}</>;
}
