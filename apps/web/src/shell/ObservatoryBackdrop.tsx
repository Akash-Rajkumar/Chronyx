import React, { useMemo } from 'react';

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_PALETTE = ['#E8EEFF', '#E8EEFF', '#CFFAFE', '#7CE8FF', '#C7D2FE'] as const;

function generateStarShadows(count: number, seed: number): string {
  const rand = mulberry32(seed);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * 2000);
    const y = Math.floor(rand() * 2000);
    const color = STAR_PALETTE[Math.floor(rand() * STAR_PALETTE.length)] ?? '#E8EEFF';
    parts.push(`${x}px ${y}px ${color}`);
  }
  return parts.join(', ');
}

/**
 * Unified non-interactive Mission Control observatory backdrop:
 * - Calm 2-layer deterministic pure-CSS starfield
 * - Ultra-faint polar coordinate reticle behind the upper workspace
 * - Completely paused under `prefers-reduced-motion: reduce`
 */
export const ObservatoryBackdrop: React.FC = () => {
  const starsFine = useMemo(() => generateStarShadows(340, 401), []);
  const starsMid = useMemo(() => generateStarShadows(90, 809), []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none absolute inset-0 z-0 overflow-hidden"
    >
      {/* Distant Polar Observatory Reticle */}
      <svg
        viewBox="0 0 1200 720"
        preserveAspectRatio="xMidYMin slice"
        className="absolute inset-0 h-full w-full opacity-[0.06] text-cyan-200"
      >
        <g stroke="currentColor" fill="none" strokeWidth="0.75">
          <circle cx="860" cy="180" r="140" />
          <circle cx="860" cy="180" r="280" strokeDasharray="4 6" />
          <circle cx="860" cy="180" r="440" />
          <line x1="280" y1="180" x2="1200" y2="180" strokeDasharray="3 7" />
          <line x1="860" y1="0" x2="860" y2="720" strokeDasharray="3 7" />
          <line x1="560" y1="0" x2="1160" y2="360" opacity="0.45" />
          <line x1="560" y1="360" x2="1160" y2="0" opacity="0.45" />
        </g>
      </svg>

      {/* Parallax Star Layer 1 (Fine, Restrained Drift) */}
      <div
        className="mc-star-layer-1 absolute left-0 top-0 h-[1px] w-[1px] bg-transparent opacity-[0.45]"
        style={{ boxShadow: starsFine }}
      >
        <div
          className="absolute top-[2000px] h-[1px] w-[1px] bg-transparent"
          style={{ boxShadow: starsFine }}
        />
      </div>

      {/* Parallax Star Layer 2 (Medium) */}
      <div
        className="mc-star-layer-2 absolute left-0 top-0 h-[2px] w-[2px] bg-transparent opacity-[0.55]"
        style={{ boxShadow: starsMid }}
      >
        <div
          className="absolute top-[2000px] h-[2px] w-[2px] bg-transparent"
          style={{ boxShadow: starsMid }}
        />
      </div>
    </div>
  );
};
