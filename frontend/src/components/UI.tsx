import type { ReactNode } from 'react';

interface SpinnerProps {
  size?: number;
  className?: string;
}

export function Spinner({ size = 4, className = '' }: SpinnerProps) {
  const px = size * 4;
  return (
    <span
      className={`inline-block animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      style={{ width: px, height: px }}
      role="status"
      aria-label="Loading"
    />
  );
}

interface CardProps {
  children: ReactNode;
  className?: string;
  title?: ReactNode;
  action?: ReactNode;
}

export function Card({ children, className = '', title, action }: CardProps) {
  return (
    <div className={`rounded-2xl border border-slate-800 bg-slate-900/60 backdrop-blur p-5 shadow-xl ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between mb-4">
          {title && <h2 className="text-white font-semibold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </div>
  );
}
