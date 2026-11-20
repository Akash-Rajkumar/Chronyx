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
    info: 'border-accent-cyan/40 bg-card text-foreground',
    success: 'border-trust-trusted/40 bg-card text-trust-trusted',
    warning: 'border-trust-suspect/40 bg-card text-trust-suspect',
    error: 'border-trust-quarantined/40 bg-card text-trust-quarantined',
  }[type];

  return (
    <div
      role="alert"
      className={`flex items-center justify-between gap-3 px-4 py-3 rounded-lg border shadow-lg text-sm transition-all duration-200 ${typeStyles} ${className}`}
    >
      <span>{message}</span>
      {onClose && (
        <button
          onClick={onClose}
          className="text-muted hover:text-foreground text-xs font-bold px-1"
          aria-label="Close notification"
        >
          ✕
        </button>
      )}
    </div>
  );
};
