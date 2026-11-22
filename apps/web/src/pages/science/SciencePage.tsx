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
import { Card } from '../../ui/Card.js';
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
    <svg
      viewBox={viewBox}
      className="w-full h-48 rounded-lg bg-background/70 border border-border/60"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>

      {/* Subtle crosshairs */}
      <line x1={-900} y1={0} x2={900} y2={0} stroke="#1F2B4A" strokeWidth={1} strokeDasharray="4 4" />
      <line x1={0} y1={-450} x2={0} y2={450} stroke="#1F2B4A" strokeWidth={1} strokeDasharray="4 4" />

      {/* Ground-truth asteroid ellipse */}
      <ellipse
        cx={truth.x0}
        cy={-truth.y0}
        rx={Math.abs(truth.a)}
        ry={Math.abs(truth.b)}
        fill="rgba(61, 220, 151, 0.08)"
        stroke="#3DDC97"
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
                stroke="#9FB0D6"
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
          ? '#9FB0D6'
          : st.faulty
            ? '#FF5C5C'
            : '#9FB0D6';
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

  return (
    <div className={`space-y-6 transition-opacity ${isReconnecting ? 'opacity-65' : 'opacity-100'}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Science Impact Replay
            </h2>
            <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-card border border-border text-muted">
              Simulated geometry
            </span>
            {isMock && (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan">
                SIMULATED (MOCK)
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            At 20 km/s, 1 ms of timing error moves a chord by 20 m.
          </p>
        </div>
      </div>

      {/* Controls */}
      <Card className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5 items-end">
          {/* Fault size slider 0..20 ms */}
          <label className="block space-y-1.5 text-xs">
            <div className="flex items-center justify-between">
              <span className="text-muted flex items-center gap-1">
                Injected fault size (ms)
                <InfoTip text="Timing offset injected into the faulty occultation station before ellipse fitting." />
              </span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
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

          {/* Faulty station selector 0..5 */}
          <div className="space-y-1.5 text-xs">
            <span className="text-muted block">Faulty station (cross-track y)</span>
            <div className="grid grid-cols-3 gap-1.5">
              {STATION_INDICES.map((idx) => {
                const yM = SCIENCE_DEFAULTS.stations_y[idx];
                const isSelected = faultyStation === idx;
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setFaultyStation(idx)}
                    className={`px-2 py-1.5 rounded-md font-mono text-[11px] border transition-colors ${
                      isSelected
                        ? 'bg-accent-cyan/15 border-accent-cyan text-accent-cyan'
                        : 'bg-background/50 border-border text-muted hover:border-muted/60'
                    }`}
                  >
                    {`S${idx + 1} (${yM}m)`}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Use live fault button */}
          <div className="flex flex-col items-start md:items-end gap-1.5">
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
            <span className="text-[11px] font-mono text-muted tabular-nums">
              {liveFaultCopy.supported
                ? `Active ${liveFaultCopy.faultType}: ${liveFaultCopy.sizeMs.toFixed(1)} ms (params.offset_ms)`
                : liveFaultCopy.reason}
            </span>
          </div>
        </div>
      </Card>

      {/* Error banner (when prior data exists or standalone) */}
      {error && hasData && (
        <div className="p-3 rounded-lg bg-trust-quarantined/10 border border-trust-quarantined/30 text-xs text-trust-quarantined flex items-center justify-between">
          <span>Replay update failed: {error}</span>
          <button
            type="button"
            onClick={() => void runReplay(faultMs, faultyStation)}
            className="underline hover:opacity-80"
          >
            Retry
          </button>
        </div>
      )}

      {/* Main 3-panel SVG comparison */}
      {loading && !hasData ? (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div data-testid="science-panel-truth">
            <Skeleton height={280} />
          </div>
          <div data-testid="science-panel-trusted">
            <Skeleton height={280} />
          </div>
          <div data-testid="science-panel-quarantined">
            <Skeleton height={280} />
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
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div data-testid="science-panel-truth">
            <Card className="p-4 text-xs text-muted">Truth — waiting for replay response</Card>
          </div>
          <div data-testid="science-panel-trusted">
            <Card className="p-4 text-xs text-muted">
              Fault trusted — waiting for replay response
            </Card>
          </div>
          <div data-testid="science-panel-quarantined">
            <Card className="p-4 text-xs text-muted">
              Fault quarantined — waiting for replay response
            </Card>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Panel 1: Truth */}
          <div data-testid="science-panel-truth">
            <Card className="space-y-3 h-full">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-trust-trusted">Truth</h3>
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
              <div className="text-xs text-muted space-y-1">
                <div className="font-mono text-foreground font-semibold tabular-nums">
                  Size error 0.0% (reference body)
                </div>
                <p className="text-[11px]">
                  True occultation profile with 6 stations at {trustedRes.params.shadow_speed_kms}{' '}
                  km/s shadow speed.
                </p>
              </div>
            </Card>
          </div>

          {/* Panel 2: Fault trusted */}
          <div data-testid="science-panel-trusted">
            <Card className="space-y-3 h-full">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-trust-quarantined">Fault trusted</h3>
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
              <div className="text-xs text-muted space-y-1">
                <div className="font-mono text-trust-quarantined font-semibold tabular-nums">
                  {`Size error ${trustedRes.mean_size_error_pct.toFixed(1)}% (mean over ${trustedRes.trials} trials)`}
                </div>
                <p className="text-[11px] font-mono tabular-nums">
                  {`First trial: ${trustedRes.size_error_pct.toFixed(1)}% · Faulty station included`}
                </p>
              </div>
            </Card>
          </div>

          {/* Panel 3: Fault quarantined */}
          <div data-testid="science-panel-quarantined">
            <Card className="space-y-3 h-full">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-accent-cyan">Fault quarantined</h3>
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
              <div className="text-xs text-muted space-y-1">
                <div className="font-mono text-accent-cyan font-semibold tabular-nums">
                  {`Size error ${quarantinedRes.mean_size_error_pct.toFixed(1)}% (mean over ${quarantinedRes.trials} trials)`}
                </div>
                <p className="text-[11px] font-mono tabular-nums">
                  {`First trial: ${quarantinedRes.size_error_pct.toFixed(1)}% · Faulty station dropped`}
                </p>
              </div>
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}
