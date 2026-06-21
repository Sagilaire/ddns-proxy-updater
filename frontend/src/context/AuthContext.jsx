import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, setToken, getToken } from '../api/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => getToken());

  const logout = useCallback(() => {
    setToken('');
    setTokenState('');
  }, []);

  const login = useCallback(async (password) => {
    const { token } = await api.post('/auth/login', { password }, { _noAuth: true });
    setToken(token);
    setTokenState(token);
    return token;
  }, []);

  useEffect(() => {
    const handler = () => logout();
    window.addEventListener('ddns:unauthorized', handler);
    return () => window.removeEventListener('ddns:unauthorized', handler);
  }, [logout]);

  return (
    <AuthContext.Provider value={{ token, login, logout, isAuthenticated: !!token }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
