import React from 'react';

export interface CardProps {
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  dataTestId?: string;
  onClick?: () => void;
}

export const Card: React.FC<CardProps> = ({
  title,
  subtitle,
  action,
  children,
  className = '',
  dataTestId,
  onClick,
}) => {
  return (
    <div
      data-testid={dataTestId}
      onClick={onClick}
      className={`chronyx-glass rounded-xl ${
        onClick
          ? 'cursor-pointer transition-[border-color,transform,box-shadow] duration-[180ms] ease-out hover:-translate-y-[1px] hover:border-accent-cyan/35 hover:shadow-[inset_0_1px_0_rgba(165,243,252,0.18),0_14px_32px_rgba(2,6,23,0.46)] active:translate-y-0'
          : ''
      } ${className}`}
    >
      {(title || subtitle || action) && (
        <div className="flex items-start justify-between p-4 border-b border-white/[0.08]">
          <div>
            {title && (
              <h3 className="font-semibold text-sm tracking-tight text-foreground">
                {title}
              </h3>
            )}
            {subtitle && (
              <p className="text-xs text-muted mt-0.5">{subtitle}</p>
            )}
          </div>
          {action && <div className="shrink-0 ml-3">{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
};
