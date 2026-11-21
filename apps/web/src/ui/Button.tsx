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
    'inline-flex items-center justify-center font-medium rounded-[10px] transition-[background-color,border-color,color,transform,box-shadow] duration-[180ms] ease-out select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 focus-visible:ring-offset-1 focus-visible:ring-offset-[#060b16] disabled:opacity-45 disabled:cursor-not-allowed disabled:hover:translate-y-0 disabled:shadow-none';

  const variants = {
    primary:
      'bg-accent-cyan text-[#050B16] font-semibold shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_2px_10px_rgba(61,214,245,0.16)] hover:bg-[#5BE0F7] hover:-translate-y-[1px] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.65),0_6px_18px_rgba(61,214,245,0.24)] active:translate-y-[0.5px] active:shadow-[inset_0_1px_2px_rgba(5,11,22,0.35)]',
    secondary:
      'bg-white/[0.05] text-foreground border border-white/[0.13] shadow-[inset_0_1px_0_rgba(255,255,255,0.09)] hover:bg-white/[0.09] hover:border-white/[0.22] active:translate-y-[0.5px] active:shadow-none',
    danger:
      'bg-trust-quarantined/[0.12] text-trust-quarantined border border-trust-quarantined/35 hover:bg-trust-quarantined/[0.2] hover:border-trust-quarantined/55 active:translate-y-[0.5px]',
    ghost:
      'text-muted hover:text-foreground hover:bg-white/[0.06] active:translate-y-[0.5px]',
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
