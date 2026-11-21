import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SCIENCE_DEFAULTS } from '@chronyx/contracts';
import type {
  Ellipse,
  Fault,
  FaultType,
  ScienceReplayRes,
  ScienceStation,
} from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import {
  useConnectionStatus,
  useDashboardStore,
  useFaults,
} from '../../state/useDashboardStore.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { InfoTip } from '../../ui/InfoTip.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { GlassPanel, LiquidGlassShell } from '../../present/LiquidGlass.js';

const DEFAULT_TRIALS = 200;
const DEFAULT_SEED = 42;
const STATION_INDICES = [0, 1, 2, 3, 4, 5] as const;

type LiveFaultCopyState =
  | { supported: true; sizeMs: number; faultType: FaultType }
  | { supported: false; reason: string };

function extractLiveFaultCopyState(faults: Fault[]): LiveFaultCopyState {
  const active = faults.find((f) => f.status === 'active');
  if (!active) {
    return { supported: false, reason: 'No active fault detected' };
  }

  if (
    (active.type === 'clock_step' || active.type === 'camera_delay') &&
    typeof active.params.offset_ms === 'number' &&
    !Number.isNaN(active.params.offset_ms)
  ) {
    const absOffset = Math.abs(active.params.offset_ms);
    if (absOffset > 20) {
      return {
        supported: false,
        reason: `Active ${active.type} offset (${absOffset.toFixed(1)} ms) exceeds the 0–20 ms science replay slider range`,
      };
    }
    return {
      supported: true,
      sizeMs: Number(absOffset.toFixed(1)),
      faultType: active.type,
    };
  }

  return {
    supported: false,
    reason: `Active ${active.type} fault has no fixed injected offset_ms size`,
  };
}

function computeSvgViewBox(
  truth: Ellipse,
  fitted: Ellipse | null,
  stations: ScienceStation[],
): string {
  let maxX = Math.max(380, Math.abs(truth.x0) + Math.abs(truth.a) + 60);
  let maxY = Math.max(210, Math.abs(truth.y0) + Math.abs(truth.b) + 50);

  if (fitted) {
    maxX = Math.max(maxX, Math.abs(fitted.x0) + Math.abs(fitted.a) + 60);
    maxY = Math.max(maxY, Math.abs(fitted.y0) + Math.abs(fitted.b) + 50);
  }

  for (const st of stations) {
    maxY = Math.max(maxY, Math.abs(st.y_m) + 40);
    if (st.chord_x_m) {
      maxX = Math.max(maxX, Math.abs(st.chord_x_m[0]) + 50, Math.abs(st.chord_x_m[1]) + 50);
    }
  }

  // Cap extreme unstable fits so the SVG stays readable
  const clampedX = Math.min(maxX, 900);
  const clampedY = Math.min(maxY, 450);
  return `${-clampedX} ${-clampedY} ${clampedX * 2} ${clampedY * 2}`;
}

interface OccultationSvgProps {
  title: string;
  truth: Ellipse;
  fitted: Ellipse | null;
  stations: ScienceStation[];
  fittedColor: string;
  showTrueChordsOnly?: boolean;
}

function OccultationSvg({
  title,
  truth,
  fitted,
  stations,
  fittedColor,
  showTrueChordsOnly = false,
}: OccultationSvgProps) {
  const viewBox = computeSvgViewBox(truth, fitted, stations);

  return (
    <div className="rounded-xl bg-[#040814]/65 border border-white/15 p-2 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]">
      <svg
        viewBox={viewBox}
        className="w-full h-52 rounded-lg"
        role="img"
        aria-label={title}
      >
        <title>{title}</title>

        {/* Illuminated observatory reticle grid */}
        <line x1={-900} y1={-150} x2={900} y2={-150} stroke="rgba(139,92,246,0.16)" strokeWidth={1} />
        <line x1={-900} y1={150} x2={900} y2={150} stroke="rgba(139,92,246,0.16)" strokeWidth={1} />
        <line x1={-250} y1={-450} x2={-250} y2={450} stroke="rgba(56,189,248,0.16)" strokeWidth={1} />
        <line x1={250} y1={-450} x2={250} y2={450} stroke="rgba(56,189,248,0.16)" strokeWidth={1} />
        <line
          x1={-900}
          y1={0}
          x2={900}
          y2={0}
          stroke="rgba(148,163,184,0.30)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <line
          x1={0}
          y1={-450}
          x2={0}
          y2={450}
          stroke="rgba(148,163,184,0.30)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Ground-truth asteroid ellipse */}
        <ellipse
          cx={truth.x0}
          cy={-truth.y0}
          rx={Math.abs(truth.a)}
          ry={Math.abs(truth.b)}
          fill="rgba(52, 211, 153, 0.12)"
          stroke="#34D399"
          strokeWidth={2.5}
        />

        {/* Station chords */}
        {stations.map((st) => {
          if (showTrueChordsOnly) {
            const ratio = st.y_m / truth.b;
            if (Math.abs(ratio) >= 1) return null;
            const halfX = truth.a * Math.sqrt(1 - ratio * ratio);
            return (
              <g key={st.idx}>
                <line
                  x1={-halfX}
                  y1={-st.y_m}
                  x2={halfX}
                  y2={-st.y_m}
                  stroke="#CBD5E1"
                  strokeWidth={2}
                />
                <circle cx={-halfX} cy={-st.y_m} r={4.5} fill="#34D399" />
                <circle cx={halfX} cy={-st.y_m} r={4.5} fill="#34D399" />
              </g>
            );
          }

          if (!st.chord_x_m) return null;
          const [x1, x2] = st.chord_x_m;
          const strokeColor = st.dropped
            ? '#94A3B8'
            : st.faulty
              ? '#FB7185'
              : '#CBD5E1';
          return (
            <g key={st.idx} opacity={st.dropped ? 0.35 : 1}>
              <line
                x1={x1}
                y1={-st.y_m}
                x2={x2}
                y2={-st.y_m}
                stroke={strokeColor}
                strokeWidth={st.faulty ? 3 : 2}
                strokeDasharray={st.dropped ? '6 4' : undefined}
              />
              <circle cx={x1} cy={-st.y_m} r={4.5} fill={strokeColor} />
              <circle cx={x2} cy={-st.y_m} r={4.5} fill={strokeColor} />
            </g>
          );
        })}

        {/* Fitted dashed ellipse */}
        {fitted && (
          <ellipse
            cx={fitted.x0}
            cy={-fitted.y0}
            rx={Math.abs(fitted.a)}
            ry={Math.abs(fitted.b)}
            fill="none"
            stroke={fittedColor}
            strokeWidth={3.2}
            strokeDasharray="10 6"
          />
        )}
      </svg>
    </div>
  );
}

/**
 * Science Impact Page (Part G4.5)
 * Owned by Person 4 (P4-T4)
 */
export function SciencePage() {
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const faultsHook = useFaults();
  const connectionStatusHook = useConnectionStatus();

  const isClient = typeof window !== 'undefined';
  const snapshotState = isClient ? null : useDashboardStore.getState();

  const faults = isClient ? faultsHook : snapshotState!.faults;
  const connectionStatus = isClient ? connectionStatusHook : snapshotState!.connectionStatus;

  const [faultMs, setFaultMs] = useState<number>(10);
  const [faultyStation, setFaultyStation] = useState<number>(0);

  const [trustedRes, setTrustedRes] = useState<ScienceReplayRes | null>(null);
  const [quarantinedRes, setQuarantinedRes] = useState<ScienceReplayRes | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const requestSeqRef = useRef<number>(0);

  const liveFaultCopy = useMemo(() => extractLiveFaultCopyState(faults), [faults]);

  const runReplay = useCallback(async (sizeMs: number, stationIdx: number) => {
    const seq = ++requestSeqRef.current;
    setLoading(true);
    setError(null);

    try {
      const [trusted, quarantined] = await Promise.all([
        api.replayScience({
          fault_ms: sizeMs,
          faulty_station: stationIdx,
          quarantine: false,
          trials: DEFAULT_TRIALS,
          seed: DEFAULT_SEED,
        }),
        api.replayScience({
          fault_ms: sizeMs,
          faulty_station: stationIdx,
          quarantine: true,
          trials: DEFAULT_TRIALS,
          seed: DEFAULT_SEED,
        }),
      ]);

      if (seq !== requestSeqRef.current) return;
      setTrustedRes(trusted);
      setQuarantinedRes(quarantined);
    } catch (err) {
      if (seq !== requestSeqRef.current) return;
      setError(err instanceof Error ? err.message : 'Failed to run science replay');
    } finally {
      if (seq === requestSeqRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    void runReplay(faultMs, faultyStation);
  }, [runReplay, faultMs, faultyStation]);

  const handleUseLiveFault = () => {
    if (liveFaultCopy.supported) {
      setFaultMs(liveFaultCopy.sizeMs);
    }
  };

  const isReconnecting = connectionStatus === 'disconnected' || connectionStatus === 'error';
  const isMock = connectionStatus === 'mock';
  const hasData = trustedRes !== null && quarantinedRes !== null;

  const impliedChordShiftM = faultMs * 20;

  return (
    <LiquidGlassShell accent="violet" speed={1.1} dimmed={isReconnecting}>
      {/* Liquid-Glass Science Header + Physical Sensitivity Callout */}
      <GlassPanel tone="violet" padding="p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-violet-300">
                Occultation Geometry Console
              </span>
              <span className="inline-flex items-center text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-violet-400/18 border border-violet-300/40 text-violet-200">
                Simulated geometry
              </span>
              {isMock && (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-cyan-400/15 border border-cyan-300/45 text-cyan-200 shadow-[0_0_14px_rgba(61,214,245,0.22)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                  SIMULATED (MOCK)
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Science Impact Replay
            </h2>
            <p className="text-sm text-slate-300">
              Visualizing how a single timing fault distorts an asteroid chord fit vs quarantining it
            </p>
          </div>

          <div className="px-4 py-3 rounded-xl bg-black/35 border border-cyan-300/35 backdrop-blur-md flex flex-col sm:flex-row sm:items-center gap-2.5 sm:gap-4 shrink-0 shadow-[0_0_24px_rgba(139,92,246,0.16)]">
            <div className="text-xs text-slate-100">
              <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-cyan-300 block">
                Physical Sensitivity
              </span>
              <span>At 20 km/s, 1 ms of timing error moves a chord by 20 m.</span>
            </div>
            <div className="sm:border-l sm:border-white/15 sm:pl-4 font-mono tabular-nums">
              <span className="text-[10px] uppercase tracking-wider text-violet-200/80 block">
                Chord shift
              </span>
              <span className="text-base font-bold text-cyan-200">
                {`${impliedChordShiftM.toFixed(0)} m`}
              </span>
            </div>
          </div>
        </div>
      </GlassPanel>

      {/* Compact Liquid-Glass Controls */}
      <GlassPanel tone="default" padding="p-4">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-center">
          {/* Fault size slider 0..20 ms */}
          <div className="lg:col-span-4 p-3.5 rounded-xl bg-black/30 border border-white/12">
            <label className="block space-y-2 text-xs">
              <div className="flex items-center justify-between">
                <span className="text-slate-200 flex items-center gap-1">
                  Injected fault size (ms)
                  <InfoTip text="Timing offset injected into the faulty occultation station before ellipse fitting." />
                </span>
                <span className="font-mono font-bold text-cyan-200 px-2 py-0.5 rounded-md bg-cyan-400/15 border border-cyan-300/40 tabular-nums">
                  {`${faultMs.toFixed(1)} ms`}
                </span>
              </div>
              <input
                type="range"
                min={0}
                max={20}
                step={0.5}
                value={faultMs}
                onChange={(e) => setFaultMs(Number(e.target.value))}
                className="w-full accent-cyan-400"
                aria-label="Fault size in milliseconds"
              />
              <div className="flex justify-between text-[10px] font-mono text-slate-400">
                <span>0 ms</span>
                <span>10 ms</span>
                <span>20 ms</span>
              </div>
            </label>
          </div>

          {/* Faulty station selector 0..5 */}
          <div className="lg:col-span-5 space-y-2 text-xs">
            <span className="text-slate-200 font-medium block">Faulty station (cross-track y)</span>
            <div className="grid grid-cols-3 gap-1.5">
              {STATION_INDICES.map((idx) => {
                const yM = SCIENCE_DEFAULTS.stations_y[idx];
                const isSelected = faultyStation === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    aria-pressed={isSelected}
                    onClick={() => setFaultyStation(idx)}
                    className={`px-2.5 py-2 rounded-xl font-mono text-[11px] border transition-all hover:-translate-y-[1px] focus:outline-none focus:ring-2 focus:ring-violet-300/60 ${
                      isSelected
                        ? 'bg-violet-400/22 border-violet-300/60 text-white font-semibold shadow-[0_0_18px_rgba(139,92,246,0.28)]'
                        : 'bg-white/[0.045] border-white/12 text-slate-300 hover:bg-white/[0.08] hover:border-white/25'
                    }`}
                  >
                    {`S${idx + 1} (${yM}m)`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Use live fault button */}
          <div className="lg:col-span-3 flex flex-col items-start lg:items-end gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={!liveFaultCopy.supported}
              title={
                liveFaultCopy.supported
                  ? `Copy injected ${liveFaultCopy.faultType} offset_ms (${liveFaultCopy.sizeMs.toFixed(1)} ms)`
                  : liveFaultCopy.reason
              }
              onClick={handleUseLiveFault}
              className="bg-white/[0.08] border-white/20 text-white hover:bg-cyan-400/20 hover:border-cyan-300/45 hover:-translate-y-[1px]"
            >
              Use the live fault
            </Button>
            <span className="text-[11px] font-mono text-slate-300/85 lg:text-right tabular-nums leading-snug">
              {liveFaultCopy.supported
                ? `Active ${liveFaultCopy.faultType}: ${liveFaultCopy.sizeMs.toFixed(1)} ms (params.offset_ms)`
                : liveFaultCopy.reason}
            </span>
          </div>
        </div>
      </GlassPanel>

      {/* Error banner (when prior data exists) */}
      {error && hasData && (
        <GlassPanel tone="coral" padding="px-4 py-3">
          <div className="text-xs text-rose-200 flex items-center justify-between gap-3">
            <span>Replay update failed: {error}</span>
            <button
              type="button"
              onClick={() => void runReplay(faultMs, faultyStation)}
              className="underline font-semibold hover:text-white"
            >
              Retry
            </button>
          </div>
        </GlassPanel>
      )}

      {/* Main 3-Panel Scientific Story: Truth -> Fault trusted -> Fault quarantined */}
      {loading && !hasData ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div data-testid="science-panel-truth">
            <Skeleton height={330} />
          </div>
          <div data-testid="science-panel-trusted">
            <Skeleton height={330} />
          </div>
          <div data-testid="science-panel-quarantined">
            <Skeleton height={330} />
          </div>
        </div>
      ) : error && !hasData ? (
        <GlassPanel tone="coral">
          <EmptyState
            title="Unable to compute science replay"
            description={error}
            action={
              <Button
                variant="primary"
                size="sm"
                onClick={() => void runReplay(faultMs, faultyStation)}
              >
                Retry
              </Button>
            }
          />
        </GlassPanel>
      ) : !hasData ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div data-testid="science-panel-truth">
            <GlassPanel tone="emerald" padding="p-4">
              <span className="text-xs text-slate-300">Truth — waiting for replay response</span>
            </GlassPanel>
          </div>
          <div data-testid="science-panel-trusted">
            <GlassPanel tone="coral" padding="p-4">
              <span className="text-xs text-slate-300">
                Fault trusted — waiting for replay response
              </span>
            </GlassPanel>
          </div>
          <div data-testid="science-panel-quarantined">
            <GlassPanel tone="cyan" padding="p-4">
              <span className="text-xs text-slate-300">
                Fault quarantined — waiting for replay response
              </span>
            </GlassPanel>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Panel 1: Truth */}
          <div data-testid="science-panel-truth" className="h-full">
            <GlassPanel tone="emerald" className="h-full">
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-300">
                      01 · Reference Body
                    </span>
                    <h3 className="text-base font-bold text-emerald-200">Truth</h3>
                  </div>
                  <span className="text-[11px] font-mono text-emerald-100 px-2.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-300/35 tabular-nums">
                    {`a=${trustedRes.truth.a.toFixed(0)}m, b=${trustedRes.truth.b.toFixed(0)}m`}
                  </span>
                </div>

                <OccultationSvg
                  title="Ground truth asteroid ellipse and reference station chords"
                  truth={trustedRes.truth}
                  fitted={null}
                  stations={trustedRes.stations}
                  fittedColor="#34D399"
                  showTrueChordsOnly
                />

                <div className="p-3 rounded-xl bg-black/30 border border-emerald-300/25 space-y-1">
                  <div className="font-mono text-sm text-emerald-200 font-bold tabular-nums">
                    Size error 0.0% (reference body)
                  </div>
                  <p className="text-[11px] text-slate-300">
                    True occultation profile with 6 stations at{' '}
                    {trustedRes.params.shadow_speed_kms} km/s shadow speed.
                  </p>
                </div>
              </div>
            </GlassPanel>
          </div>

          {/* Panel 2: Fault trusted */}
          <div data-testid="science-panel-trusted" className="h-full">
            <GlassPanel tone="coral" className="h-full">
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-rose-300">
                      02 · Unverified
                    </span>
                    <h3 className="text-base font-bold text-rose-200">Fault trusted</h3>
                  </div>
                  <span className="text-[11px] font-mono text-rose-100 px-2.5 py-0.5 rounded-full bg-rose-500/18 border border-rose-300/35 tabular-nums">
                    {`a=${trustedRes.fitted.a.toFixed(1)}m, b=${trustedRes.fitted.b.toFixed(1)}m`}
                  </span>
                </div>

                <OccultationSvg
                  title={`Fault trusted fit: mean size error ${trustedRes.mean_size_error_pct.toFixed(1)} percent`}
                  truth={trustedRes.truth}
                  fitted={trustedRes.fitted}
                  stations={trustedRes.stations}
                  fittedColor="#FB7185"
                />

                <div className="p-3 rounded-xl bg-rose-500/15 border border-rose-300/35 space-y-1">
                  <div className="font-mono text-sm text-rose-200 font-bold tabular-nums">
                    {`Size error ${trustedRes.mean_size_error_pct.toFixed(1)}% (mean over ${trustedRes.trials} trials)`}
                  </div>
                  <p className="text-[11px] font-mono text-slate-200/85 tabular-nums">
                    {`First trial: ${trustedRes.size_error_pct.toFixed(1)}% · Faulty station included`}
                  </p>
                </div>
              </div>
            </GlassPanel>
          </div>

          {/* Panel 3: Fault quarantined */}
          <div data-testid="science-panel-quarantined" className="h-full">
            <GlassPanel tone="cyan" className="h-full">
              <div className="space-y-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300">
                      03 · Chronyx Verified
                    </span>
                    <h3 className="text-base font-bold text-cyan-200">Fault quarantined</h3>
                  </div>
                  <span className="text-[11px] font-mono text-cyan-100 px-2.5 py-0.5 rounded-full bg-cyan-400/15 border border-cyan-300/35 tabular-nums">
                    {`a=${quarantinedRes.fitted.a.toFixed(1)}m, b=${quarantinedRes.fitted.b.toFixed(1)}m`}
                  </span>
                </div>

                <OccultationSvg
                  title={`Fault quarantined fit: mean size error ${quarantinedRes.mean_size_error_pct.toFixed(1)} percent`}
                  truth={quarantinedRes.truth}
                  fitted={quarantinedRes.fitted}
                  stations={quarantinedRes.stations}
                  fittedColor="#3DD6F5"
                />

                <div className="p-3 rounded-xl bg-cyan-400/15 border border-cyan-300/35 space-y-1">
                  <div className="font-mono text-sm text-cyan-100 font-bold tabular-nums">
                    {`Size error ${quarantinedRes.mean_size_error_pct.toFixed(1)}% (mean over ${quarantinedRes.trials} trials)`}
                  </div>
                  <p className="text-[11px] font-mono text-slate-200/85 tabular-nums">
                    {`First trial: ${quarantinedRes.size_error_pct.toFixed(1)}% · Faulty station dropped`}
                  </p>
                </div>
              </div>
            </GlassPanel>
          </div>
        </div>
      )}
    </LiquidGlassShell>
  );
}
