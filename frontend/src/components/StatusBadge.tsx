import type { ReactNode } from 'react';

type StatusKey = 'success' | 'error' | 'pending' | 'idle' | 'disabled';

const STYLES: Record<StatusKey, string> = {
  success:  'bg-emerald-500/10 text-emerald-300 border-emerald-500/30',
  error:    'bg-rose-500/10  text-rose-300  border-rose-500/30',
  pending:  'bg-amber-500/10  text-amber-200 border-amber-500/30',
  idle:     'bg-slate-700/40 text-slate-300 border-slate-600/40',
  disabled: 'bg-slate-700/40 text-slate-400 border-slate-600/40',
};

const LABELS: Record<StatusKey, string> = {
  success:  'Up to date',
  error:    'Error',
  pending:  'Updating…',
  idle:     'Idle',
  disabled: 'Disabled',
};

interface StatusBadgeProps {
  status?: string | null;
  customLabel?: ReactNode;
}

export default function StatusBadge({ status, customLabel }: StatusBadgeProps) {
  const key = (status ?? 'idle') as StatusKey;
  const style = STYLES[key] ?? STYLES.idle;
  const label = customLabel ?? LABELS[key] ?? key;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs border ${style}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {label}
    </span>
  );
}
