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
      className={`bg-card border border-border rounded-xl transition-all duration-200 ${
        onClick ? 'cursor-pointer hover:border-accent-cyan/40 hover:bg-card/90' : ''
      } ${className}`}
    >
      {(title || subtitle || action) && (
        <div className="flex items-start justify-between p-4 border-b border-border/50">
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
