import React from 'react';

export interface ConfidenceRingProps {
  confidence: number; // 0 to 1
  size?: number;
  strokeWidth?: number;
  showValue?: boolean;
  label?: string;
  className?: string;
}

export const ConfidenceRing: React.FC<ConfidenceRingProps> = ({
  confidence,
  size = 56,
  strokeWidth = 4,
  showValue = true,
  label,
  className = '',
}) => {
  const clamped = Math.max(0, Math.min(1, confidence));
  const percent = Math.round(clamped * 100);

  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - clamped * circumference;

  let strokeColor = '#3DDC97'; // trusted
  if (clamped < 0.7) {
    strokeColor = '#FF5C5C'; // quarantined
  } else if (clamped < 0.9) {
    strokeColor = '#F5A524'; // suspect
  }

  return (
    <div
      data-testid="confidence-ring"
      className={`inline-flex flex-col items-center justify-center gap-1 ${className}`}
    >
      <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="rotate-[-90deg]">
          {/* Background Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke="rgba(255, 255, 255, 0.10)"
            strokeWidth={strokeWidth}
          />
          {/* Progress Indicator */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="transparent"
            stroke={strokeColor}
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-[stroke-dashoffset,stroke] duration-200 ease-out"
          />
        </svg>

        {showValue && (
          <span className="absolute font-mono text-xs font-bold text-foreground tabular-nums">
            {percent}%
          </span>
        )}
      </div>

      {label && <span className="text-[11px] text-muted text-center">{label}</span>}
    </div>
  );
};
