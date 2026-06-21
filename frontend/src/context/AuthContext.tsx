import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setToken, getToken } from '../api/client';
import type { LoginResponse } from '../types';

interface AuthContextValue {
  token: string;
  login: (password: string) => Promise<string>;
  logout: () => void;
  isAuthenticated: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setTokenState] = useState<string>(() => getToken());

  const logout = useCallback(() => {
    setToken('');
    setTokenState('');
  }, []);

  const login = useCallback(async (password: string): Promise<string> => {
    const { token } = await api.post<LoginResponse>('/auth/login', { password }, { _noAuth: true });
    setToken(token);
    setTokenState(token);
    return token;
  }, []);

  useEffect(() => {
    const handler = (): void => { logout(); };
    window.addEventListener('ddns:unauthorized', handler as EventListener);
    return () => window.removeEventListener('ddns:unauthorized', handler as EventListener);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ token, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
