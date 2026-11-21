import React from 'react';
import { ObservatoryBackdrop } from '../shell/ObservatoryBackdrop.js';

export type GlassTone = 'default' | 'cyan' | 'emerald' | 'coral' | 'amber' | 'violet';

export interface ParallaxStarfieldBackdropProps {
  /** Retained for backwards compatibility. */
  speed?: number;
  /** Retained for backwards compatibility. */
  accent?: 'cyan' | 'coral' | 'violet' | 'emerald';
}

/**
 * Delegates to the unified Mission Control ObservatoryBackdrop.
 */
export const ParallaxStarfieldBackdrop: React.FC<ParallaxStarfieldBackdropProps> = () => {
  return <ObservatoryBackdrop />;
};

export interface LiquidGlassShellProps {
  children: React.ReactNode;
  accent?: 'cyan' | 'coral' | 'violet' | 'emerald';
  speed?: number;
  dimmed?: boolean;
}

/**
 * Seamless Mission Control page container sharing the app-wide ObservatoryBackdrop.
 */
export const LiquidGlassShell: React.FC<LiquidGlassShellProps> = ({
  children,
  dimmed = false,
}) => {
  return (
    <div
      className={`space-y-6 transition-opacity duration-[180ms] ease-out ${
        dimmed ? 'opacity-70' : 'opacity-100'
      }`}
    >
      {children}
    </div>
  );
};

const TONE_CLASSES: Record<GlassTone, string> = {
  default: 'mc-panel border-white/[0.11]',
  cyan: 'mc-panel-primary border-white/[0.16] border-t-2 border-t-accent-cyan/75',
  emerald: 'mc-panel border-white/[0.12] border-t-2 border-t-trust-trusted/75',
  coral: 'mc-panel border-rose-400/25 border-t-2 border-t-trust-quarantined/75',
  amber: 'mc-well border-amber-400/30 border-l-2 border-l-trust-suspect',
  violet: 'mc-panel border-indigo-400/25 border-t-2 border-t-indigo-400/75',
};

export interface GlassPanelProps {
  children: React.ReactNode;
  tone?: GlassTone;
  className?: string;
  padding?: string;
}

/**
 * Unified Mission Control panel surface aligned with shared `.mc-panel` / `.mc-panel-primary`.
 */
export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  tone = 'default',
  className = '',
  padding = 'p-5',
}) => {
  return (
    <div className={`rounded-[12px] ${TONE_CLASSES[tone]} ${padding} ${className}`}>
      {children}
    </div>
  );
};
