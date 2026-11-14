import { useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { useApi } from '../api/client';
import { ApiError, call } from '../api/errors';
import { clearSession, loadSession, saveSession } from './session';

export const SESSION_ENDED = 'Your session ended. Sign in again.';

export type Auth = {
  token: string | null;
  login: (email: string, password: string) => Promise<void>;
  logout: (reason?: 'expired') => void;
  notice: string | null;
};

const AuthContext = createContext<Auth | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const api = useApi();
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => loadSession()?.token ?? null);
  const [notice, setNotice] = useState<string | null>(null);

  const logout = useCallback(
    (reason?: 'expired') => {
      clearSession();
      setToken(null);
      setNotice(reason === 'expired' ? SESSION_ENDED : null);
      queryClient.removeQueries({ queryKey: ['backoffice'] });
    },
    [queryClient],
  );

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await call(api.POST('/v1/auth/login', { body: { email, password } }));
      saveSession(res.accessToken, res.expiresIn);
      setNotice(null);
      setToken(res.accessToken);
    },
    [api],
  );

  // Only a 401 on a backoffice query ends the session. Shop queries never match this key.
  useEffect(
    () =>
      queryClient.getQueryCache().subscribe((event) => {
        if (event.type !== 'updated' || event.action.type !== 'error') return;
        const error: unknown = event.query.state.error;
        if (
          (event.query.queryKey as readonly unknown[])[0] === 'backoffice' &&
          error instanceof ApiError &&
          error.status === 401
        ) {
          logout('expired');
        }
      }),
    [queryClient, logout],
  );

  const value = useMemo(() => ({ token, login, logout, notice }), [token, login, logout, notice]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error('useAuth must be used inside <AuthProvider>');
  return auth;
}
