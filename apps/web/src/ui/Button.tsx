import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  size?: 'sm' | 'md' | 'lg';
  loading?: boolean;
  icon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  className = '',
  disabled,
  ...props
}) => {
  const base =
    'inline-flex items-center justify-center font-medium rounded-lg transition-all duration-200 select-none focus:outline-none focus:ring-2 focus:ring-accent-cyan/50 disabled:opacity-50 disabled:cursor-not-allowed';

  const variants = {
    primary:
      'bg-accent-cyan text-background font-semibold hover:bg-accent-cyan/90 shadow-sm active:translate-y-[0.5px]',
    secondary:
      'bg-card text-foreground border border-border hover:bg-card/80 hover:border-accent-cyan/40',
    danger:
      'bg-trust-quarantined/10 text-trust-quarantined border border-trust-quarantined/30 hover:bg-trust-quarantined/20',
    ghost:
      'text-muted hover:text-foreground hover:bg-card/50',
  }[variant];

  const sizes = {
    sm: 'text-xs px-2.5 py-1.5 gap-1.5',
    md: 'text-sm px-4 py-2 gap-2',
    lg: 'text-base px-5 py-2.5 gap-2.5',
  }[size];

  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`${base} ${variants} ${sizes} ${className}`}
    >
      {loading ? (
        <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent" />
      ) : (
        icon && <span className="shrink-0">{icon}</span>
      )}
      <span>{children}</span>
    </button>
  );
};
