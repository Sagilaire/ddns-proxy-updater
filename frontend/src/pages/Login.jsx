import React, { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../api/client';
import { Spinner } from '../components/UI';

export default function Login() {
  const { login, isAuthenticated } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  if (isAuthenticated) return <Navigate to="/" replace />;

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await login(password);
      navigate('/', { replace: true });
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message);
      else setErr('Unexpected error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/70 border border-slate-800 backdrop-blur p-8 shadow-2xl animate-fade-up">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-accent-500 to-cyan-400 grid place-items-center text-slate-900 font-bold">
            D
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">Proxy DDNS Updater</h1>
            <p className="text-xs text-slate-400">Sign in to manage your DNS records</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block">
            <span className="text-xs uppercase tracking-wider text-slate-400">Admin password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoFocus
              required
              className="mt-1 w-full bg-slate-800/80 border border-slate-700 rounded-lg px-3 py-2 text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-accent-500 focus:border-transparent"
              placeholder="••••••••"
            />
          </label>
          {err && (
            <div className="text-sm text-rose-300 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {err}
            </div>
          )}
          <button
            type="submit"
            disabled={busy || !password}
            className="w-full inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-gradient-to-br from-accent-600 to-accent-500 hover:from-accent-500 hover:to-accent-400 text-white font-medium shadow-lg shadow-accent-600/30 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
          >
            {busy ? <Spinner size={4} /> : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
