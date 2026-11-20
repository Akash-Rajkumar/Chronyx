import React from 'react';

export interface EmptyStateProps {
  title: string;
  description?: string;
  icon?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  title,
  description,
  icon,
  action,
  className = '',
}) => {
  return (
    <div
      className={`flex flex-col items-center justify-center p-8 text-center rounded-xl border border-dashed border-border/80 bg-card/20 space-y-3 ${className}`}
    >
      {icon && <div className="text-3xl text-muted/60">{icon}</div>}
      <div className="space-y-1">
        <h4 className="font-semibold text-sm text-foreground">{title}</h4>
        {description && <p className="text-xs text-muted max-w-sm">{description}</p>}
      </div>
      {action && <div className="pt-2">{action}</div>}
    </div>
  );
};
