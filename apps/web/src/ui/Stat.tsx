import React from 'react';

export interface StatProps {
  label: string;
  value: React.ReactNode;
  unit?: string;
  change?: string;
  trend?: 'up' | 'down' | 'neutral';
  info?: string;
  className?: string;
  dataTestId?: string;
}

export const Stat: React.FC<StatProps> = ({
  label,
  value,
  unit,
  change,
  trend,
  info,
  className = '',
  dataTestId,
}) => {
  const trendColor =
    trend === 'up'
      ? 'text-trust-trusted'
      : trend === 'down'
      ? 'text-trust-quarantined'
      : 'text-muted';

  return (
    <div
      data-testid={dataTestId}
      className={`chronyx-glass p-4 rounded-xl space-y-2 ${className}`}
    >
      <div className="flex items-center justify-between pb-1.5 border-b border-white/[0.07]">
        <span className="text-xs text-muted font-medium tracking-tight flex items-center gap-1">
          {label}
        </span>
        {info && (
          <span className="text-[10px] text-muted/70 cursor-help" title={info}>
            ⓘ
          </span>
        )}
      </div>

      <div className="flex items-baseline gap-1.5">
        <span className="text-2xl font-semibold tracking-tight text-foreground font-mono tabular-nums">
          {value}
        </span>
        {unit && <span className="text-xs text-muted font-mono">{unit}</span>}
      </div>

      {change && (
        <div className={`text-xs font-mono tabular-nums flex items-center gap-1 ${trendColor}`}>
          {trend === 'up' ? '▲' : trend === 'down' ? '▼' : '●'} {change}
        </div>
      )}
    </div>
  );
};
