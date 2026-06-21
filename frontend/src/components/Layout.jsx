import React from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

function NavItem({ to, icon, label }) {
  return (
    <NavLink
      to={to}
      end
      className={({ isActive }) =>
        [
          'flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent-600/20 text-white'
            : 'text-slate-300 hover:text-white hover:bg-slate-800/60',
        ].join(' ')
      }
    >
      <span className="w-5 h-5 inline-flex items-center justify-center">{icon}</span>
      {label}
    </NavLink>
  );
}

const Icon = {
  Dashboard: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="2">
      <path d="M3 12 12 3l9 9" />
      <path d="M5 10v10h14V10" />
    </svg>
  ),
  Hosts: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
      <circle cx="7" cy="7"  r="1" fill="currentColor" />
      <circle cx="7" cy="17" r="1" fill="currentColor" />
    </svg>
  ),
  Settings: (
    <svg viewBox="0 0 24 24" fill="none" className="w-5 h-5" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3h.1a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8v.1a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  ),
  Logout: (
    <svg viewBox="0 0 24 24" fill="none" className="w-4 h-4" stroke="currentColor" strokeWidth="2">
      <path d="M15 12H4" />
      <path d="m12 7 -3 5 3 5" />
      <path d="M19 21V5a2 2 0 0 0-2-2H7" />
    </svg>
  ),
};

export default function Layout({ children }) {
  const { logout } = useAuth();
  const location = useLocation();

  const pageTitle = {
    '/':        'Dashboard',
    '/hosts':   'Hosts',
    '/settings': 'Settings',
  }[location.pathname] || 'DDNS Updater';

  return (
    <div className="min-h-screen flex">
      <aside className="w-64 shrink-0 hidden md:flex flex-col gap-2 border-r border-slate-800/80 bg-slate-950/60 backdrop-blur px-4 py-6">
        <div className="px-3 mb-6">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent-500 to-cyan-400 grid place-items-center text-slate-900 font-bold shadow-lg shadow-accent-500/30">
              D
            </div>
            <div>
              <div className="text-white font-semibold leading-tight">DDNS Updater</div>
              <div className="text-xs text-slate-400">v1.0</div>
            </div>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          <NavItem to="/"        icon={Icon.Dashboard} label="Dashboard" />
          <NavItem to="/hosts"   icon={Icon.Hosts}     label="Hosts" />
          <NavItem to="/settings" icon={Icon.Settings} label="Settings" />
        </nav>
        <div className="mt-auto px-3 pt-6 border-t border-slate-800/60">
          <button
            onClick={logout}
            className="w-full inline-flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-slate-800/70 hover:bg-slate-700 text-slate-200 text-sm transition-colors"
          >
            <span className="w-4 h-4">{Icon.Logout}</span>
            Log out
          </button>
        </div>
      </aside>

      <main className="flex-1 min-w-0">
        <header className="sticky top-0 z-10 backdrop-blur bg-slate-950/60 border-b border-slate-800/80">
          <div className="px-6 md:px-10 h-16 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-semibold text-white">{pageTitle}</h1>
            </div>
            <div className="hidden md:flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse-dot" />
              Connected
            </div>
          </div>
        </header>
        <div className="px-6 md:px-10 py-8 max-w-6xl animate-fade-up">{children}</div>
      </main>
    </div>
  );
}
