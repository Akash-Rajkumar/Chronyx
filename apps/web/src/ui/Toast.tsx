import React, { useEffect } from 'react';

export interface ToastProps {
  id?: string;
  message: string;
  type?: 'info' | 'success' | 'warning' | 'error';
  onClose?: () => void;
  durationMs?: number;
  className?: string;
}

export const Toast: React.FC<ToastProps> = ({
  message,
  type = 'info',
  onClose,
  durationMs = 4000,
  className = '',
}) => {
  useEffect(() => {
    if (!durationMs || !onClose) return;
    const timer = setTimeout(onClose, durationMs);
    return () => clearTimeout(timer);
  }, [durationMs, onClose]);

  const typeStyles = {
    info: 'border-white/[0.16] border-l-2 border-l-accent-cyan text-foreground',
    success: 'border-white/[0.16] border-l-2 border-l-trust-trusted text-trust-trusted',
    warning: 'border-white/[0.16] border-l-2 border-l-trust-suspect text-trust-suspect',
    error: 'border-white/[0.16] border-l-2 border-l-trust-quarantined text-trust-quarantined',
  }[type];

  return (
    <div
      role="alert"
      className={`chronyx-glass-elevated flex items-center justify-between gap-3 px-4 py-3 rounded-xl text-sm transition-[opacity,transform] duration-[180ms] ease-out ${typeStyles} ${className}`}
    >
      <span>{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="text-muted hover:text-foreground text-xs font-bold px-1.5 py-0.5 rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
          aria-label="Close notification"
        >
          ✕
        </button>
      )}
    </div>
  );
};
