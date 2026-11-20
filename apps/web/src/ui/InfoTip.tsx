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
      className={`relative inline-flex items-center group cursor-help ${className}`}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
      onFocus={() => setVisible(true)}
      onBlur={() => setVisible(false)}
      tabIndex={0}
      role="button"
      aria-label={text}
    >
      {children || (
        <span className="inline-flex items-center justify-center h-3.5 w-3.5 rounded-full border border-muted/50 text-[10px] text-muted group-hover:text-foreground group-hover:border-foreground/80 transition-colors">
          ?
        </span>
      )}

      {visible && (
        <span
          role="tooltip"
          className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 rounded-lg bg-card border border-border text-foreground text-xs shadow-xl z-50 pointer-events-none transition-all duration-150 leading-relaxed font-normal"
        >
          {text}
          <span className="absolute top-full left-1/2 -translate-x-1/2 border-4 border-transparent border-t-card" />
        </span>
      )}
    </span>
  );
};
