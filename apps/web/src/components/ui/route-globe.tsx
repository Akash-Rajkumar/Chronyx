import { useEffect, useRef, useState, type CSSProperties } from 'react';
import type { FaultType, NodeKind, TrustState, UUID } from '@chronyx/contracts';
import {
  drawGlobe,
  landDots,
  rotate,
  slerp,
  toVec,
  type Vec3,
} from './route-globe-utils/globe.js';
import './route-globe.css';

/**
 * Route Globe — Repurposed for Chronyx Global Observatory
 * A dotted 3D globe with great-circle sync arcs from the Chronyx Verification Hub.
 * Each route lifts off the surface on a great circle; a telemetry comet runs along it
 * and the node pulses on arrival. Drag to spin; turns slowly when idle.
 */

export type Place = {
  id: UUID;
  name: string;
  lon: number;
  lat: number;
  note?: string;
  kind: NodeKind;
  online: boolean;
  trustState: TrustState | 'unassessed';
  hasActiveFault: boolean;
  activeFaultType?: FaultType;
  errorEstMs: number | null;
  confidence: number | null;
};

export type HubPlace = {
  name: string;
  lon: number;
  lat: number;
};

export type GlobeTheme = {
  ground: string;
  land: string;
  arc: string;
  glow: string;
  text: string;
  muted: string;
};

export const CHRONYX_HUB: HubPlace = {
  name: 'Chronyx Hub',
  lon: 24.0,
  lat: 24.0,
};

export const CHRONYX_GLOBE_THEME: GlobeTheme = {
  ground: '#06080d',
  land: '#8ba4cc',
  arc: '#3dd6f5',
  glow: 'rgb(61 214 245 / 0.16)',
  text: '#eef2fb',
  muted: '#7c8aa5',
};

type Props = {
  hub?: HubPlace;
  places: Place[];
  selectedId?: UUID | null;
  focusTarget?: { lon: number; lat: number; seq: number } | null;
  onSelectPlace?: (place: Place) => void;
  theme?: GlobeTheme;
  motion?: 'full' | 'reduced';
  className?: string;
  style?: CSSProperties;
};

function getNodeVisualPalette(p: Place): {
  stroke: string;
  fill: string;
  badgeText: string;
  badgeClass: string;
  dotClass: string;
} {
  if (!p.online) {
    return {
      stroke: '#64748b',
      fill: '#64748b',
      badgeText: 'OFFLINE',
      badgeClass: 'text-slate-400 border-slate-500/40 bg-slate-900/80',
      dotClass: 'bg-slate-400',
    };
  }
  switch (p.trustState) {
    case 'quarantined':
      return {
        stroke: '#ff4d4f',
        fill: '#ff4d4f',
        badgeText: 'QUARANTINED',
        badgeClass: 'text-red-300 border-red-500/70 bg-red-950/90 rg__label--quarantined',
        dotClass: 'bg-red-500 shadow-[0_0_8px_#ff4d4f]',
      };
    case 'suspect':
      return {
        stroke: '#f59e0b',
        fill: '#f59e0b',
        badgeText: 'SUSPECT',
        badgeClass: 'text-amber-200 border-amber-400/60 bg-amber-950/85',
        dotClass: 'bg-amber-400 shadow-[0_0_8px_#f59e0b]',
      };
    case 'recovering':
      return {
        stroke: '#818cf8',
        fill: '#818cf8',
        badgeText: 'RECOVERING',
        badgeClass: 'text-indigo-200 border-indigo-400/60 bg-indigo-950/85',
        dotClass: 'bg-indigo-400 shadow-[0_0_8px_#818cf8]',
      };
    case 'trusted':
      return {
        stroke: '#3dd6f5',
        fill: '#3dd6f5',
        badgeText: 'TRUSTED',
        badgeClass: 'text-cyan-200 border-cyan-400/40 bg-[#081221]/85',
        dotClass: 'bg-cyan-400 shadow-[0_0_8px_#3dd6f5]',
      };
    default:
      return {
        stroke: '#94a3b8',
        fill: '#94a3b8',
        badgeText: 'UNASSESSED',
        badgeClass: 'text-slate-200 border-slate-500/40 bg-[#0b1220]/85',
        dotClass: 'bg-slate-400',
      };
  }
}

export function RouteGlobe({
  hub = CHRONYX_HUB,
  places,
  selectedId = null,
  focusTarget = null,
  onSelectPlace,
  theme = CHRONYX_GLOBE_THEME,
  motion = 'full',
  className = '',
  style,
}: Props) {
  const host = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const labelRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  const hubLabelRef = useRef<HTMLDivElement>(null);

  // Keep latest props in refs so real-time state updates never reset globe rotation/momentum!
  const placesRef = useRef<Place[]>(places);
  const selectedIdRef = useRef<UUID | null>(selectedId);
  const onSelectRef = useRef(onSelectPlace);
  const hubRef = useRef(hub);
  const themeRef = useRef(theme);
  const focusGoalRef = useRef<{ yaw: number; tilt: number } | null>(null);

  placesRef.current = places;
  selectedIdRef.current = selectedId;
  onSelectRef.current = onSelectPlace;
  hubRef.current = hub;
  themeRef.current = theme;

  const [hover, setHover] = useState<{ p: Place; x: number; y: number } | null>(null);

  useEffect(() => {
    if (!focusTarget) return;
    const RAD = Math.PI / 180;
    focusGoalRef.current = {
      yaw: focusTarget.lon * RAD,
      tilt: Math.max(-0.75, Math.min(0.75, focusTarget.lat * RAD * 0.75)),
    };
  }, [focusTarget]);

  useEffect(() => {
    const el = host.current;
    const cv = canvas.current;
    if (!el || !cv) return;
    const ctx = cv.getContext('2d');
    if (!ctx) return;

    const reduced =
      motion === 'reduced' ||
      (typeof window !== 'undefined' &&
        typeof window.matchMedia === 'function' &&
        window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    const dots = landDots(
      typeof window !== 'undefined' && window.innerWidth < 640 ? 18000 : 30000,
    );
    const RAD = Math.PI / 180;
    const st = {
      yaw: hubRef.current.lon * RAD - 0.25,
      tilt: 18 * RAD,
      vy: 0,
      vt: 0,
      drag: false,
      px: 0,
      py: 0,
      downX: 0,
      downY: 0,
      moved: false,
      last: 0,
      idle: 0,
    };

    let W = 0;
    let Hh = 0;
    let dpr = 1;
    let raf = 0;
    let alive = true;
    let visible = true;
    const t0 = performance.now();
    const pins: { p: Place; x: number; y: number; front: boolean }[] = [];

    const size = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = el.clientWidth;
      Hh = el.clientHeight;
      cv.width = Math.round(W * dpr);
      cv.height = Math.round(Hh * dpr);
    };

    const project = (v: Vec3, lift: number, r: number, cx: number, cy: number) => {
      const [x, y, z] = rotate(v, st.yaw, st.tilt);
      return { x: cx + x * r * lift, y: cy - y * r * lift, z };
    };

    const draw = (now: number) => {
      const curTheme = themeRef.current;
      const curHub = hubRef.current;
      const curPlaces = placesRef.current;
      const curSelectedId = selectedIdRef.current;

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, Hh);

      const r = Math.min(W, Hh) * (W < 640 ? 0.37 : 0.39);
      const cx = W / 2;
      const cy = Hh / 2 + (W < 640 ? 10 : 14);

      drawGlobe(
        ctx,
        dots,
        { cx, cy, r, yaw: st.yaw, tilt: st.tilt },
        curTheme.land,
        Math.max(1.4, r / 150),
        curTheme.glow,
      );

      const H = toVec(curHub.lon, curHub.lat);
      const t = (now - t0) / 1000;
      pins.length = 0;
      ctx.lineCap = 'round';

      const count = Math.max(1, curPlaces.length);

      for (let i = 0; i < curPlaces.length; i++) {
        const p = curPlaces[i]!;
        const v = toVec(p.lon, p.lat);
        const offset = i / count;
        const palette = getNodeVisualPalette(p);
        const isSelected = curSelectedId === p.id;
        const isQuarantined = p.online && p.trustState === 'quarantined';

        const ang = Math.acos(
          Math.max(-1, Math.min(1, H[0] * v[0] + H[1] * v[1] + H[2] * v[2])),
        );
        const height = 0.08 + ang * 0.13;
        const pts: { x: number; y: number; z: number }[] = [];
        for (let k = 0; k <= 48; k++) {
          const u = k / 48;
          pts.push(
            project(slerp(H, v, u), 1 + Math.sin(Math.PI * u) * height, r, cx, cy),
          );
        }

        // Arc: faint behind the globe, colored by real trust state
        ctx.strokeStyle = palette.stroke;
        ctx.lineWidth = isSelected || isQuarantined ? 1.65 : 1.15;
        for (let k = 0; k < 48; k++) {
          const a = pts[k]!;
          const b = pts[k + 1]!;
          const hidden = a.z < 0 && Math.hypot(a.x - cx, a.y - cy) < r;
          ctx.globalAlpha = hidden
            ? 0.05
            : !p.online
              ? 0.16
              : isSelected || isQuarantined
                ? 0.62
                : 0.36;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }

        // Comet particle along active online routes
        const cycle = isQuarantined ? 2.4 : 3.6;
        const ph = reduced ? 0.999 : (t / cycle + offset) % 1;
        if (p.online) {
          const run = Math.min(1, ph / 0.7);
          const head = Math.floor(run * 48);
          for (let k = Math.max(0, head - 10); k < head; k++) {
            const a = pts[k]!;
            const b = pts[k + 1]!;
            if (a.z < 0 && Math.hypot(a.x - cx, a.y - cy) < r) continue;
            ctx.globalAlpha = (1 - (head - k) / 10) * 0.95;
            ctx.lineWidth = isQuarantined ? 2.8 : 2.2;
            ctx.beginPath();
            ctx.moveTo(a.x, a.y);
            ctx.lineTo(b.x, b.y);
            ctx.stroke();
          }
        }

        const end = pts[48]!;
        const front = end.z > 0;
        pins.push({ p, x: end.x, y: end.y, front });

        if (front) {
          // Quarantined red outer halo + double pulse rings
          if (isQuarantined) {
            const glowGrad = ctx.createRadialGradient(
              end.x,
              end.y,
              2,
              end.x,
              end.y,
              32,
            );
            glowGrad.addColorStop(0, 'rgba(255, 77, 79, 0.72)');
            glowGrad.addColorStop(0.45, 'rgba(255, 77, 79, 0.25)');
            glowGrad.addColorStop(1, 'rgba(255, 77, 79, 0)');
            ctx.globalAlpha = 1;
            ctx.fillStyle = glowGrad;
            ctx.beginPath();
            ctx.arc(end.x, end.y, 32, 0, Math.PI * 2);
            ctx.fill();

            // Continuous twin red radar pulse
            const q1 = (t * 0.75) % 1;
            const q2 = (t * 0.75 + 0.5) % 1;
            ctx.strokeStyle = '#ff4d4f';
            ctx.lineWidth = 1.8;
            ctx.globalAlpha = (1 - q1) * 0.85;
            ctx.beginPath();
            ctx.arc(end.x, end.y, 5 + q1 * 24, 0, Math.PI * 2);
            ctx.stroke();

            ctx.globalAlpha = (1 - q2) * 0.7;
            ctx.beginPath();
            ctx.arc(end.x, end.y, 5 + q2 * 24, 0, Math.PI * 2);
            ctx.stroke();
          } else if (p.hasActiveFault && p.online) {
            // Active fault (not yet quarantined): distinct amber outer pulse
            const fPhase = (t * 0.9) % 1;
            ctx.strokeStyle = '#f59e0b';
            ctx.lineWidth = 1.6;
            ctx.globalAlpha = (1 - fPhase) * 0.8;
            ctx.beginPath();
            ctx.arc(end.x, end.y, 5 + fPhase * 18, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Selected target reticle
          if (isSelected) {
            ctx.globalAlpha = 0.95;
            ctx.strokeStyle = isQuarantined ? '#ff4d4f' : '#eef2fb';
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.arc(end.x, end.y, 11, 0, Math.PI * 2);
            ctx.stroke();
          }

          // Node pin core
          ctx.globalAlpha = 1;
          ctx.fillStyle = palette.fill;
          ctx.beginPath();
          ctx.arc(end.x, end.y, isQuarantined ? 4.8 : isSelected ? 4.2 : 3.4, 0, Math.PI * 2);
          ctx.fill();

          // Bright white center dot for contrast
          ctx.fillStyle = '#ffffff';
          ctx.globalAlpha = p.online ? 0.9 : 0.4;
          ctx.beginPath();
          ctx.arc(end.x, end.y, 1.4, 0, Math.PI * 2);
          ctx.fill();

          // Arrival pulse on comet landing
          if (p.online && ph > 0.7 && !isQuarantined) {
            const k = (ph - 0.7) / 0.3;
            ctx.strokeStyle = palette.stroke;
            ctx.globalAlpha = (1 - k) * 0.85;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.arc(end.x, end.y, 4 + k * 15, 0, Math.PI * 2);
            ctx.stroke();
          }
        }

        // Update floating DOM label position smoothly (zero React re-renders!)
        const labelEl = labelRefs.current.get(p.id);
        if (labelEl) {
          if (front && end.z > 0.04) {
            const edgeFade = Math.min(1, (end.z - 0.04) / 0.22);
            labelEl.style.transform = `translate3d(${(end.x + 14).toFixed(1)}px, ${end.y.toFixed(1)}px, 0) translateY(-50%)`;
            labelEl.style.opacity = `${edgeFade.toFixed(3)}`;
            labelEl.style.pointerEvents = 'auto';
          } else {
            labelEl.style.opacity = '0';
            labelEl.style.pointerEvents = 'none';
          }
        }
      }

      // Draw Chronyx Hub
      const h = project(H, 1, r, cx, cy);
      if (h.z > 0) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = curTheme.text;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 4.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 0.4 + 0.45 * Math.sin(t * 3);
        ctx.strokeStyle = curTheme.arc;
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.arc(h.x, h.y, 10, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (hubLabelRef.current) {
        if (h.z > 0.12) {
          const edgeFade = Math.min(1, (h.z - 0.12) / 0.25);
          hubLabelRef.current.style.transform = `translate3d(${h.x.toFixed(1)}px, ${h.y.toFixed(1)}px, 0)`;
          hubLabelRef.current.style.opacity = `${(edgeFade * 0.85).toFixed(3)}`;
        } else {
          hubLabelRef.current.style.opacity = '0';
        }
      }

      ctx.globalAlpha = 1;
    };

    const tick = (now: number) => {
      raf = 0;
      if (!alive || !visible || document.hidden) return;
      const dt = st.last ? Math.min(0.05, (now - st.last) / 1000) : 0.016;
      st.last = now;
      if (!st.drag) {
        if (focusGoalRef.current) {
          // Smoothly rotate globe to bring focused node to the front
          const goal = focusGoalRef.current;
          let dYaw = goal.yaw - st.yaw;
          while (dYaw > Math.PI) dYaw -= Math.PI * 2;
          while (dYaw < -Math.PI) dYaw += Math.PI * 2;
          const dTilt = goal.tilt - st.tilt;
          const step = Math.min(1, dt * 4.5);
          st.yaw += dYaw * step;
          st.tilt += dTilt * step;
          st.idle = now;
          if (Math.abs(dYaw) < 0.01 && Math.abs(dTilt) < 0.01) {
            focusGoalRef.current = null;
          }
        } else {
          st.yaw += st.vy * dt;
          st.tilt += st.vt * dt;
          st.vy *= Math.pow(0.05, dt);
          st.vt *= Math.pow(0.05, dt);
          if (now - st.idle > 2800 && !selectedIdRef.current) {
            st.yaw += dt * 0.075;
          }
          st.tilt = Math.max(
            -0.9,
            Math.min(0.9, st.tilt + (18 * RAD - st.tilt) * Math.min(1, dt * 0.35)),
          );
        }
      }
      draw(now);
      raf = requestAnimationFrame(tick);
    };

    const start = () => {
      if (reduced) return draw(performance.now());
      if (!raf && alive) {
        st.last = 0;
        raf = requestAnimationFrame(tick);
      }
    };

    const onDown = (e: PointerEvent) => {
      cv.setPointerCapture(e.pointerId);
      st.drag = true;
      st.moved = false;
      st.px = e.clientX;
      st.py = e.clientY;
      st.downX = e.clientX;
      st.downY = e.clientY;
      st.vy = 0;
      st.vt = 0;
      focusGoalRef.current = null;
      el.dataset.dragging = '';
    };

    const onMove = (e: PointerEvent) => {
      if (st.drag) {
        const r = Math.max(100, Math.min(W, Hh) * 0.4);
        const dx = e.clientX - st.px;
        const dy = e.clientY - st.py;
        if (Math.hypot(e.clientX - st.downX, e.clientY - st.downY) > 5) {
          st.moved = true;
        }
        st.px = e.clientX;
        st.py = e.clientY;
        st.yaw -= dx / r;
        st.tilt = Math.max(-0.9, Math.min(0.9, st.tilt + dy / r));
        st.vy = (-dx / r) * 28;
        st.vt = (dy / r) * 28;
        st.idle = performance.now();
        if (reduced) draw(performance.now());
        setHover(null);
        return;
      }

      const b = cv.getBoundingClientRect();
      const x = e.clientX - b.left;
      const y = e.clientY - b.top;
      const near = pins
        .filter((p) => p.front)
        .map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) }))
        .sort((a, b2) => a.d - b2.d)[0];
      setHover(near && near.d < 22 ? { p: near.p, x: near.x, y: near.y } : null);
    };

    const onUp = (e: PointerEvent) => {
      const wasClick = st.drag && !st.moved;
      st.drag = false;
      st.idle = performance.now();
      delete el.dataset.dragging;

      if (wasClick && onSelectRef.current) {
        const b = cv.getBoundingClientRect();
        const x = e.clientX - b.left;
        const y = e.clientY - b.top;
        const near = pins
          .filter((p) => p.front)
          .map((p) => ({ ...p, d: Math.hypot(p.x - x, p.y - y) }))
          .sort((a, b2) => a.d - b2.d)[0];
        if (near && near.d < 28) {
          onSelectRef.current(near.p);
        }
      }
    };

    const onLeave = () => setHover(null);

    cv.addEventListener('pointerdown', onDown);
    cv.addEventListener('pointermove', onMove);
    cv.addEventListener('pointerup', onUp);
    cv.addEventListener('pointercancel', onUp);
    cv.addEventListener('pointerleave', onLeave);

    const ro = new ResizeObserver(() => {
      size();
      draw(performance.now());
    });
    ro.observe(el);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry ? entry.isIntersecting : true;
      if (visible) start();
    });
    io.observe(el);

    const onVis = () => {
      if (!document.hidden) start();
    };
    document.addEventListener('visibilitychange', onVis);

    size();
    start();

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
      document.removeEventListener('visibilitychange', onVis);
      cv.removeEventListener('pointerdown', onDown);
      cv.removeEventListener('pointermove', onMove);
      cv.removeEventListener('pointerup', onUp);
      cv.removeEventListener('pointercancel', onUp);
      cv.removeEventListener('pointerleave', onLeave);
    };
  }, [motion]);

  return (
    <div
      ref={host}
      className={`rg ${className}`}
      style={{
        background: theme.ground,
        color: theme.text,
        ['--rg-muted' as string]: theme.muted,
        ['--rg-arc' as string]: theme.arc,
        ['--rg-ground' as string]: theme.ground,
        ...style,
      }}
    >
      <canvas
        ref={canvas}
        className="rg__canvas"
        role="img"
        aria-label={`Interactive Chronyx Observatory globe displaying ${places.length} timing nodes`}
      />

      {/* Chronyx Hub Subtle Label */}
      <div
        ref={hubLabelRef}
        className="pointer-events-none absolute left-0 top-0 z-10 -translate-x-1/2 translate-y-3 opacity-0 transition-opacity duration-150"
      >
        <div className="px-2 py-0.5 rounded-full bg-[#06080d]/80 border border-white/15 text-[10px] font-mono tracking-wider text-white/75 whitespace-nowrap">
          {hub.name}
        </div>
      </div>

      {/* Interactive Clickable Node Labels */}
      <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
        {places.map((p) => {
          const palette = getNodeVisualPalette(p);
          const isSelected = selectedId === p.id;
          const kindLabel = p.kind === 'virtual' ? 'SIMULATED' : 'REAL';
          const statusLabel = p.online ? 'ONLINE' : 'OFFLINE';

          return (
            <button
              key={p.id}
              ref={(node) => {
                if (node) {
                  labelRefs.current.set(p.id, node);
                } else {
                  labelRefs.current.delete(p.id);
                }
              }}
              type="button"
              data-testid={`globe-node-label-${p.id}`}
              onClick={(e) => {
                e.stopPropagation();
                onSelectPlace?.(p);
              }}
              style={{ opacity: 0 }}
              className={`absolute left-0 top-0 text-left rounded-lg px-2.5 py-1.5 border backdrop-blur-md transition-[border-color,background-color,box-shadow] duration-200 cursor-pointer focus:outline-none focus:ring-2 focus:ring-accent-cyan/60 ${palette.badgeClass} ${
                isSelected ? 'ring-2 ring-white/80 z-20' : 'hover:border-white/50 z-10'
              }`}
            >
              <div className="flex items-center gap-1.5 whitespace-nowrap">
                <span className={`w-2 h-2 rounded-full shrink-0 ${palette.dotClass}`} />
                <span className="text-xs font-semibold text-white tracking-tight leading-none">
                  {p.name}
                </span>
                {p.hasActiveFault && p.trustState !== 'quarantined' && (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-mono font-bold uppercase tracking-wider bg-amber-500/25 text-amber-200 border border-amber-400/50 leading-none">
                    FAULT
                  </span>
                )}
              </div>
              <div className="mt-1 text-[9.5px] font-mono tracking-wider uppercase opacity-90 whitespace-nowrap leading-none">
                {`${kindLabel} · ${palette.badgeText} · ${statusLabel}`}
              </div>
            </button>
          );
        })}
      </div>

      {/* Hover Tooltip on Canvas Pin */}
      {hover && (
        <div
          className="rg__tip"
          style={{ left: hover.x, top: hover.y }}
          aria-hidden="true"
        >
          <strong>{hover.p.name}</strong>
          <span>
            {hover.p.errorEstMs !== null
              ? `Error: ${hover.p.errorEstMs >= 0 ? '+' : ''}${hover.p.errorEstMs.toFixed(2)} ms`
              : 'Click to inspect node'}
          </span>
        </div>
      )}

      {/* Accessible Screen-Reader Summary */}
      <ul className="rg__sr">
        {places.map((p) => (
          <li key={p.id}>
            {p.name}: {p.kind}, {p.trustState}, {p.online ? 'online' : 'offline'}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default RouteGlobe;
