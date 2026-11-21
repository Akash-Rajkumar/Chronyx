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
    <div className="mc-well rounded-[10px] p-2">
      <svg
        viewBox={viewBox}
        className="w-full h-52 rounded-[8px]"
        role="img"
        aria-label={title}
      >
        <title>{title}</title>

        {/* Observatory Reticle Grid */}
        <line x1={-900} y1={-150} x2={900} y2={-150} stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
        <line x1={-900} y1={150} x2={900} y2={150} stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
        <line x1={-250} y1={-450} x2={-250} y2={450} stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
        <line x1={250} y1={-450} x2={250} y2={450} stroke="rgba(148,163,184,0.12)" strokeWidth={1} />
        <line
          x1={-900}
          y1={0}
          x2={900}
          y2={0}
          stroke="rgba(148,163,184,0.28)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />
        <line
          x1={0}
          y1={-450}
          x2={0}
          y2={450}
          stroke="rgba(148,163,184,0.28)"
          strokeWidth={1}
          strokeDasharray="4 4"
        />

        {/* Ground-truth asteroid ellipse */}
        <ellipse
          cx={truth.x0}
          cy={-truth.y0}
          rx={Math.abs(truth.a)}
          ry={Math.abs(truth.b)}
          fill="rgba(61, 220, 151, 0.1)"
          stroke="#3DDC97"
          strokeWidth={2.4}
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
                <circle cx={-halfX} cy={-st.y_m} r={4} fill="#3DDC97" />
                <circle cx={halfX} cy={-st.y_m} r={4} fill="#3DDC97" />
              </g>
            );
          }

          if (!st.chord_x_m) return null;
          const [x1, x2] = st.chord_x_m;
          const strokeColor = st.dropped
            ? '#94A3B8'
            : st.faulty
              ? '#FF5C5C'
              : '#CBD5E1';
          return (
            <g key={st.idx} opacity={st.dropped ? 0.35 : 1}>
              <line
                x1={x1}
                y1={-st.y_m}
                x2={x2}
                y2={-st.y_m}
                stroke={strokeColor}
                strokeWidth={st.faulty ? 2.8 : 2}
                strokeDasharray={st.dropped ? '6 4' : undefined}
              />
              <circle cx={x1} cy={-st.y_m} r={4} fill={strokeColor} />
              <circle cx={x2} cy={-st.y_m} r={4} fill={strokeColor} />
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
            strokeWidth={3}
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
    <div
      className={`space-y-5 transition-opacity duration-[180ms] ease-out ${
        isReconnecting ? 'opacity-70' : 'opacity-100'
      }`}
    >
      {/* Header + Physics Sensitivity Callout */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Science Impact Replay
            </h2>
            <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-indigo-500/12 border border-indigo-400/30 text-indigo-200">
              Simulated geometry
            </span>
            {isMock && (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-amber-500/12 border border-amber-400/30 text-amber-200">
                SIMULATED (MOCK)
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            How one faulty station clock distorts an asteroid chord fit vs quarantining it
          </p>
        </div>

        <div className="mc-panel-primary mc-ticks rounded-[12px] px-4 py-3 flex items-center gap-4 shrink-0">
          <div className="text-xs">
            <span className="text-[11px] font-mono text-accent-cyan block">
              Physical Sensitivity
            </span>
            <span className="text-foreground">
              At 20 km/s, 1 ms of timing error moves a chord by 20 m.
            </span>
          </div>
          <div className="border-l border-white/[0.1] pl-4 font-mono tabular-nums text-right">
            <span className="text-[10px] text-muted block">Chord shift</span>
            <span className="text-base font-semibold text-accent-cyan">
              {impliedChordShiftM.toFixed(0)} m
            </span>
          </div>
        </div>
      </div>

      {/* Compact Instrument Controls */}
      <div className="mc-panel rounded-[14px] p-4 grid grid-cols-1 lg:grid-cols-12 gap-5 items-center">
        <div className="lg:col-span-4 mc-well rounded-[10px] p-3.5">
          <label className="block space-y-2 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted flex items-center gap-1">
                Injected fault size (ms)
                <InfoTip text="Timing offset injected into the faulty occultation station before ellipse fitting." />
              </span>
              <span className="font-mono font-semibold text-accent-cyan tabular-nums">
                {faultMs.toFixed(1)} ms
              </span>
            </div>
            <input
              type="range"
              min={0}
              max={20}
              step={0.5}
              value={faultMs}
              onChange={(e) => setFaultMs(Number(e.target.value))}
              className="w-full accent-accent-cyan"
              aria-label="Fault size in milliseconds"
            />
            <div className="flex justify-between text-[10px] font-mono text-muted">
              <span>0 ms</span>
              <span>10 ms</span>
              <span>20 ms</span>
            </div>
          </label>
        </div>

        <div className="lg:col-span-5 space-y-2 text-xs">
          <span className="text-muted font-medium block">Faulty station (cross-track y)</span>
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
                  className={`px-2.5 py-2 rounded-[8px] font-mono text-[11px] border transition-[background-color,border-color,color] duration-[160ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 ${
                    isSelected
                      ? 'bg-accent-cyan/[0.14] border-accent-cyan/60 text-accent-cyan font-semibold'
                      : 'bg-black/30 border-white/[0.1] text-muted hover:border-white/[0.22] hover:text-foreground'
                  }`}
                >
                  {`S${idx + 1} (${yM}m)`}
                </button>
              );
            })}
          </div>
        </div>

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
          >
            Use the live fault
          </Button>
          <span className="text-[11px] font-mono text-muted lg:text-right tabular-nums leading-snug">
            {liveFaultCopy.supported
              ? `Active ${liveFaultCopy.faultType}: ${liveFaultCopy.sizeMs.toFixed(1)} ms (params.offset_ms)`
              : liveFaultCopy.reason}
          </span>
        </div>
      </div>

      {error && hasData && (
        <div className="mc-well border-rose-400/30 border-l-2 border-l-trust-quarantined rounded-[10px] px-4 py-3 text-xs text-rose-100 flex items-center justify-between gap-3">
          <span>Replay update failed: {error}</span>
          <button
            type="button"
            onClick={() => void runReplay(faultMs, faultyStation)}
            className="underline font-medium hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      {/* Three-Panel Occultation Comparison */}
      {loading && !hasData ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div data-testid="science-panel-truth">
            <Skeleton height={320} />
          </div>
          <div data-testid="science-panel-trusted">
            <Skeleton height={320} />
          </div>
          <div data-testid="science-panel-quarantined">
            <Skeleton height={320} />
          </div>
        </div>
      ) : error && !hasData ? (
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
      ) : !hasData ? (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div data-testid="science-panel-truth" className="mc-panel rounded-[14px] p-4 text-xs text-muted">
            Truth — waiting for replay response
          </div>
          <div data-testid="science-panel-trusted" className="mc-panel rounded-[14px] p-4 text-xs text-muted">
            Fault trusted — waiting for replay response
          </div>
          <div data-testid="science-panel-quarantined" className="mc-panel rounded-[14px] p-4 text-xs text-muted">
            Fault quarantined — waiting for replay response
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Panel 1: Truth */}
          <div
            data-testid="science-panel-truth"
            className="mc-panel border-t-2 border-t-trust-trusted/75 rounded-[14px] p-5 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-[11px] text-trust-trusted block">
                  01 · Reference Body
                </span>
                <h3 className="text-base font-semibold text-foreground">Truth</h3>
              </div>
              <span className="text-[11px] font-mono text-muted tabular-nums">
                {`a=${trustedRes.truth.a.toFixed(0)}m, b=${trustedRes.truth.b.toFixed(0)}m`}
              </span>
            </div>

            <OccultationSvg
              title="Ground truth asteroid ellipse and reference station chords"
              truth={trustedRes.truth}
              fitted={null}
              stations={trustedRes.stations}
              fittedColor="#3DDC97"
              showTrueChordsOnly
            />

            <div className="pt-1 space-y-1">
              <div className="font-mono text-sm text-trust-trusted font-semibold tabular-nums">
                Size error 0.0% (reference body)
              </div>
              <p className="text-[11px] text-muted">
                True occultation profile with 6 stations at {trustedRes.params.shadow_speed_kms}{' '}
                km/s shadow speed.
              </p>
            </div>
          </div>

          {/* Panel 2: Fault trusted */}
          <div
            data-testid="science-panel-trusted"
            className="mc-panel border-rose-400/20 border-t-2 border-t-trust-quarantined/75 rounded-[14px] p-5 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-[11px] text-trust-quarantined block">
                  02 · Unverified
                </span>
                <h3 className="text-base font-semibold text-foreground">Fault trusted</h3>
              </div>
              <span className="text-[11px] font-mono text-muted tabular-nums">
                {`a=${trustedRes.fitted.a.toFixed(1)}m, b=${trustedRes.fitted.b.toFixed(1)}m`}
              </span>
            </div>

            <OccultationSvg
              title={`Fault trusted fit: mean size error ${trustedRes.mean_size_error_pct.toFixed(1)} percent`}
              truth={trustedRes.truth}
              fitted={trustedRes.fitted}
              stations={trustedRes.stations}
              fittedColor="#FF5C5C"
            />

            <div className="pt-1 space-y-1">
              <div className="font-mono text-sm text-trust-quarantined font-semibold tabular-nums">
                {`Size error ${trustedRes.mean_size_error_pct.toFixed(1)}% (mean over ${trustedRes.trials} trials)`}
              </div>
              <p className="text-[11px] font-mono text-muted tabular-nums">
                {`First trial: ${trustedRes.size_error_pct.toFixed(1)}% · Faulty station included`}
              </p>
            </div>
          </div>

          {/* Panel 3: Fault quarantined */}
          <div
            data-testid="science-panel-quarantined"
            className="mc-panel-primary mc-ticks border-t-2 border-t-accent-cyan/75 rounded-[14px] p-5 space-y-3.5"
          >
            <div className="flex items-start justify-between gap-2">
              <div>
                <span className="font-mono text-[11px] text-accent-cyan block">
                  03 · Chronyx Verified
                </span>
                <h3 className="text-base font-semibold text-foreground">Fault quarantined</h3>
              </div>
              <span className="text-[11px] font-mono text-muted tabular-nums">
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

            <div className="pt-1 space-y-1">
              <div className="font-mono text-sm text-accent-cyan font-semibold tabular-nums">
                {`Size error ${quarantinedRes.mean_size_error_pct.toFixed(1)}% (mean over ${quarantinedRes.trials} trials)`}
              </div>
              <p className="text-[11px] font-mono text-muted tabular-nums">
                {`First trial: ${quarantinedRes.size_error_pct.toFixed(1)}% · Faulty station dropped`}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
