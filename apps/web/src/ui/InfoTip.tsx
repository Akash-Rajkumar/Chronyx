import React, { useState } from 'react';

export interface InfoTipProps {
  text: string;
  children?: React.ReactNode;
  className?: string;
}

export const InfoTip: React.FC<InfoTipProps> = ({
  text,
  children,
  className = '',
}) => {
  const [visible, setVisible] = useState(false);

  return (
    <span
      className={`relative inline-flex items-center group cursor-help focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 rounded-full ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      tabIndex={0}
      role="button"
      aria-label={text}
    >
      {children || (
        <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full border border-white/25 bg-white/[0.04] text-[10px] text-muted group-hover:text-foreground group-hover:border-accent-cyan/50 transition-colors duration-[160ms] ease-out">
          ?
        </span>
      )}

      {visible && (
        <span
          role="tooltip"
          className="chronyx-glass-elevated absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-52 p-2.5 rounded-lg border-white/[0.18] text-foreground text-xs shadow-2xl z-50 pointer-events-none transition-opacity duration-[150ms] ease-out leading-relaxed font-normal"
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-[#121A2E]" />
        </span>
      )}
    </span>
  );
};
