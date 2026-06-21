import React from 'react';

const STYLES = {
  success:  'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  error:    'bg-rose-500/10  text-rose-300  border-rose-500/30',
  pending:  'bg-amber-500/10  text-amber-200 border-amber-500/30',
  idle:     'bg-slate-700/40 text-slate-300 border-slate-600/40',
};

const LABELS = {
  success: 'Up to date',
  error:   'Error',
  pending: 'Updating…',
  idle:    'Idle',
  disabled:'Disabled',
};

export default function StatusBadge({ status, customLabel }) {
  const key = status || 'idle';
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border ${STYLES[key] || STYLES.idle}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {customLabel || LABELS[key] || key}
    </span>
  );
}
