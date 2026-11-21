import React, { useMemo } from 'react';

export type GlassTone = 'default' | 'cyan' | 'emerald' | 'coral' | 'amber' | 'violet';

export interface ParallaxStarfieldBackdropProps {
  /** Animation speed multiplier (higher is faster). */
  speed?: number;
  /** Primary atmospheric refraction tint for the page. */
  accent?: 'cyan' | 'coral' | 'violet' | 'emerald';
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_PALETTE = [
  '#FFFFFF',
  '#FFFFFF',
  '#E0F2FE',
  '#7CE8FF',
  '#C7D2FE',
  '#DDD6FE',
  '#99F6E4',
] as const;

function generateStarShadows(count: number, seed: number): string {
  const rand = mulberry32(seed);
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * 2000);
    const y = Math.floor(rand() * 2000);
    const color = STAR_PALETTE[Math.floor(rand() * STAR_PALETTE.length)] ?? '#FFFFFF';
    parts.push(`${x}px ${y}px ${color}`);
  }
  return parts.join(', ');
}

/**
 * ParallaxStarfieldBackdrop
 * Adapted from the Parallax Stars Background reference into Chronyx's observatory theme.
 * - Three pure-CSS box-shadow parallax star layers moving at distinct speeds
 * - Rich cyan, indigo, violet, teal, and subtle magenta atmospheric refraction fields
 * - Sits strictly behind glass content (`z-0`, `pointer-events-none`)
 * - Respects `prefers-reduced-motion: reduce` by pausing motion
 */
export const ParallaxStarfieldBackdrop: React.FC<ParallaxStarfieldBackdropProps> = ({
  speed = 1.15,
  accent = 'cyan',
}) => {
  const shadowsSmall = useMemo(() => generateStarShadows(520, 101), []);
  const shadowsMedium = useMemo(() => generateStarShadows(180, 202), []);
  const shadowsBig = useMemo(() => generateStarShadows(75, 303), []);

  const primaryGlow =
    accent === 'violet'
      ? 'radial-gradient(circle at 22% 18%, rgba(139, 92, 246, 0.34), transparent 52%)'
      : accent === 'coral'
        ? 'radial-gradient(circle at 20% 20%, rgba(244, 63, 94, 0.24), transparent 50%)'
        : accent === 'emerald'
          ? 'radial-gradient(circle at 22% 18%, rgba(16, 185, 129, 0.28), transparent 52%)'
          : 'radial-gradient(circle at 22% 18%, rgba(61, 214, 245, 0.30), transparent 52%)';

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none select-none absolute inset-0 z-0 overflow-hidden"
    >
      <style>{`
        @keyframes chronyxAnimStar {
          from { transform: translateY(0px); }
          to { transform: translateY(-2000px); }
        }
        @keyframes chronyxNebulaDrift {
          0% { transform: translate3d(0px, 0px, 0px) scale(1); }
          50% { transform: translate3d(18px, -14px, 0px) scale(1.04); }
          100% { transform: translate3d(0px, 0px, 0px) scale(1); }
        }
        .chronyx-star-layer-1 {
          animation: chronyxAnimStar ${Math.round(44 / speed)}s linear infinite;
        }
        .chronyx-star-layer-2 {
          animation: chronyxAnimStar ${Math.round(82 / speed)}s linear infinite;
        }
        .chronyx-star-layer-3 {
          animation: chronyxAnimStar ${Math.round(130 / speed)}s linear infinite;
        }
        .chronyx-nebula-drift {
          animation: chronyxNebulaDrift 22s ease-in-out infinite;
        }
        @media (prefers-reduced-motion: reduce) {
          .chronyx-star-layer-1,
          .chronyx-star-layer-2,
          .chronyx-star-layer-3,
          .chronyx-nebula-drift {
            animation: none !important;
          }
        }
      `}</style>

      {/* Deep Space Radial Atmosphere */}
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at 50% 105%, #162847 0%, #0A1224 46%, #050814 100%)',
        }}
      />

      {/* Atmospheric Refraction Orbs (visible through liquid-glass blur) */}
      <div
        className="chronyx-nebula-drift absolute -inset-10 opacity-95"
        style={{
          backgroundImage: [
            primaryGlow,
            'radial-gradient(circle at 82% 24%, rgba(99, 102, 241, 0.28), transparent 48%)',
            'radial-gradient(circle at 68% 82%, rgba(20, 184, 166, 0.22), transparent 50%)',
            'radial-gradient(circle at 14% 78%, rgba(217, 70, 239, 0.16), transparent 45%)',
          ].join(', '),
        }}
      />

      {/* Parallax Star Layer 1 (Small, Fastest) */}
      <div
        className="chronyx-star-layer-1 absolute left-0 top-0 w-[1px] h-[1px] bg-transparent opacity-85"
        style={{ boxShadow: shadowsSmall }}
      >
        <div
          className="absolute top-[2000px] w-[1px] h-[1px] bg-transparent"
          style={{ boxShadow: shadowsSmall }}
        />
      </div>

      {/* Parallax Star Layer 2 (Medium) */}
      <div
        className="chronyx-star-layer-2 absolute left-0 top-0 w-[2px] h-[2px] bg-transparent opacity-90"
        style={{ boxShadow: shadowsMedium }}
      >
        <div
          className="absolute top-[2000px] w-[2px] h-[2px] bg-transparent"
          style={{ boxShadow: shadowsMedium }}
        />
      </div>

      {/* Parallax Star Layer 3 (Large, Slowest) */}
      <div
        className="chronyx-star-layer-3 absolute left-0 top-0 w-[3px] h-[3px] bg-transparent opacity-95"
        style={{ boxShadow: shadowsBig }}
      >
        <div
          className="absolute top-[2000px] w-[3px] h-[3px] bg-transparent"
          style={{ boxShadow: shadowsBig }}
        />
      </div>
    </div>
  );
};

export interface LiquidGlassShellProps {
  children: React.ReactNode;
  accent?: 'cyan' | 'coral' | 'violet' | 'emerald';
  speed?: number;
  dimmed?: boolean;
}

/**
 * Full-bleed P4 page canvas with Parallax Starfield behind translucent glass layers.
 */
export const LiquidGlassShell: React.FC<LiquidGlassShellProps> = ({
  children,
  accent = 'cyan',
  speed = 1.15,
  dimmed = false,
}) => {
  return (
    <div
      className={`relative isolate min-h-[calc(100vh-3rem)] -m-2 p-4 sm:p-6 rounded-2xl overflow-hidden bg-[#050814] border border-white/[0.09] shadow-[0_24px_64px_rgba(0,0,0,0.65)] transition-opacity ${
        dimmed ? 'opacity-70' : 'opacity-100'
      }`}
    >
      <ParallaxStarfieldBackdrop accent={accent} speed={speed} />
      <div className="relative z-10 space-y-5">{children}</div>
    </div>
  );
};

const TONE_STYLES: Record<
  GlassTone,
  { surface: string; border: string; rim: string; glow: string }
> = {
  default: {
    surface: 'bg-[#0A1328]/52',
    border: 'border-white/[0.14]',
    rim: 'from-cyan-300/40 via-indigo-300/20 to-transparent',
    glow: 'shadow-[inset_0_1px_0_rgba(255,255,255,0.22),inset_1px_0_0_rgba(255,255,255,0.09),0_18px_42px_rgba(2,6,23,0.58)]',
  },
  cyan: {
    surface: 'bg-gradient-to-br from-[#0A1D38]/58 via-[#0A142B]/52 to-[#071828]/56',
    border: 'border-cyan-300/30',
    rim: 'from-cyan-300/75 via-teal-300/40 to-emerald-300/15',
    glow: 'shadow-[inset_0_1px_0_rgba(165,243,252,0.32),inset_1px_0_0_rgba(165,243,252,0.14),0_20px_48px_rgba(6,182,212,0.14)]',
  },
  emerald: {
    surface: 'bg-gradient-to-br from-[#072226]/58 via-[#0A1528]/52 to-[#081A22]/56',
    border: 'border-emerald-300/30',
    rim: 'from-emerald-300/75 via-teal-300/40 to-transparent',
    glow: 'shadow-[inset_0_1px_0_rgba(167,243,208,0.30),inset_1px_0_0_rgba(167,243,208,0.12),0_20px_48px_rgba(16,185,129,0.14)]',
  },
  coral: {
    surface: 'bg-gradient-to-br from-[#271022]/58 via-[#121328]/54 to-[#190F22]/56',
    border: 'border-rose-400/30',
    rim: 'from-rose-400/75 via-fuchsia-400/30 to-transparent',
    glow: 'shadow-[inset_0_1px_0_rgba(253,164,175,0.28),inset_1px_0_0_rgba(253,164,175,0.12),0_20px_48px_rgba(244,63,94,0.14)]',
  },
  amber: {
    surface: 'bg-gradient-to-br from-[#271C0F]/62 via-[#171626]/54 to-[#1B1418]/58',
    border: 'border-amber-300/35',
    rim: 'from-amber-300/75 via-yellow-200/30 to-transparent',
    glow: 'shadow-[inset_0_1px_0_rgba(253,230,138,0.30),inset_1px_0_0_rgba(253,230,138,0.12),0_16px_40px_rgba(245,158,11,0.14)]',
  },
  violet: {
    surface: 'bg-gradient-to-br from-[#191338]/58 via-[#0D132B]/52 to-[#1A1030]/56',
    border: 'border-violet-300/30',
    rim: 'from-violet-300/75 via-fuchsia-300/35 to-cyan-300/20',
    glow: 'shadow-[inset_0_1px_0_rgba(221,214,254,0.30),inset_1px_0_0_rgba(221,214,254,0.12),0_20px_48px_rgba(139,92,246,0.16)]',
  },
};

export interface GlassPanelProps {
  children: React.ReactNode;
  tone?: GlassTone;
  className?: string;
  padding?: string;
}

/**
 * Translucent liquid-glass container with backdrop-blur, specular inner highlight,
 * and luminous gradient top rim. Lets the parallax starfield shine through cleanly.
 */
export const GlassPanel: React.FC<GlassPanelProps> = ({
  children,
  tone = 'default',
  className = '',
  padding = 'p-5',
}) => {
  const styles = TONE_STYLES[tone];
  return (
    <div
      className={`relative overflow-hidden rounded-2xl border backdrop-blur-xl ${styles.surface} ${styles.border} ${styles.glow} ${padding} ${className}`}
    >
      {/* Top luminous gradient rim */}
      <div
        aria-hidden="true"
        className={`pointer-events-none absolute inset-x-0 top-0 h-[1.5px] bg-gradient-to-r ${styles.rim}`}
      />
      {/* Subtle diagonal glass sheen */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-gradient-to-br from-white/[0.06] via-transparent to-transparent"
      />
      <div className="relative z-10">{children}</div>
    </div>
  );
};
