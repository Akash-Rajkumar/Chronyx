import React from 'react';
import type { TrustState } from '@chronyx/contracts';
import { TRUST_STATES } from './tokens.js';

export interface StateChipProps {
  state: TrustState;
  size?: 'sm' | 'md' | 'lg';
  showSymbol?: boolean;
  showLabel?: boolean;
  className?: string;
}

export const StateChip: React.FC<StateChipProps> = ({
  state,
  size = 'md',
  showSymbol = true,
  showLabel = true,
  className = '',
}) => {
  const def = TRUST_STATES[state] || TRUST_STATES.trusted;

  const sizeClasses = {
    sm: 'text-[11px] px-1.5 py-0.5 gap-1',
    md: 'text-xs px-2.5 py-1 gap-1.5',
    lg: 'text-sm px-3 py-1.5 gap-2 font-medium',
  }[size];

  return (
    <span
      data-testid="state-chip"
      className={`inline-flex items-center rounded-[6px] font-mono border backdrop-blur-sm ${def.bgClass} ${def.textClass} ${def.borderClass} ${sizeClasses} ${className}`}
      title={`Trust state: ${def.label}`}
    >
      {showSymbol && <span className="font-bold leading-none">{def.symbol}</span>}
      {showLabel && <span>{def.label}</span>}
    </span>
  );
};
