/**
 * Design Tokens for Chronyx (Part G1)
 * Dark theme only
 */
import type { TrustState } from '@chronyx/contracts';

export const COLORS = {
  background: '#0B1220',
  card: '#121A2E',
  border: '#1F2B4A',
  text: '#E8EEFF',
  muted: '#9FB0D6',
  accent: '#3DD6F5',
} as const;

export const TRUST_STATES: Record<
  TrustState,
  {
    label: string;
    symbol: string;
    color: string;
    bgClass: string;
    textClass: string;
    borderClass: string;
  }
> = {
  trusted: {
    label: 'Trusted',
    symbol: '●',
    color: '#3DDC97',
    bgClass: 'bg-[#3DDC97]/10',
    textClass: 'text-[#3DDC97]',
    borderClass: 'border-[#3DDC97]/30',
  },
  suspect: {
    label: 'Suspect',
    symbol: '▲',
    color: '#F5A524',
    bgClass: 'bg-[#F5A524]/10',
    textClass: 'text-[#F5A524]',
    borderClass: 'border-[#F5A524]/30',
  },
  quarantined: {
    label: 'Quarantined',
    symbol: '■',
    color: '#FF5C5C',
    bgClass: 'bg-[#FF5C5C]/10',
    textClass: 'text-[#FF5C5C]',
    borderClass: 'border-[#FF5C5C]/30',
  },
  recovering: {
    label: 'Recovering',
    symbol: '◐',
    color: '#6EA8FF',
    bgClass: 'bg-[#6EA8FF]/10',
    textClass: 'text-[#6EA8FF]',
    borderClass: 'border-[#6EA8FF]/30',
  },
} as const;

export const SPACING = {
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
} as const;

export const RADIUS = '12px';

export const TRANSITIONS = {
  fast: '150ms ease-out',
  normal: '200ms ease-out',
  slow: '250ms ease-out',
} as const;
