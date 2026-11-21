import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { LiveMetrics } from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import {
  useConnectionStatus,
  useDashboardStore,
  useFaults,
  useRecentTransitions,
} from '../../state/useDashboardStore.js';
import { Button } from '../../ui/Button.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { InfoTip } from '../../ui/InfoTip.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { GlassPanel, LiquidGlassShell } from '../../present/LiquidGlass.js';
import { BenchmarkCard } from './BenchmarkCard.js';

function formatTimeUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

function formatSignedMs(val: number | null): string {
  if (val === null || Number.isNaN(val)) return '--';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)} ms`;
}

/**
 * Scoreboard Page (Part G4.6)
 * Owned by Person 4 (P4-T5) — First slice: Card A ("Measured live in this session")
 */
export function ScoreboardPage() {
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const faultsHook = useFaults();
  const transitionsHook = useRecentTransitions();
  const connectionStatusHook = useConnectionStatus();

  const isClient = typeof window !== 'undefined';
  const snapshotState = isClient ? null : useDashboardStore.getState();

  const faults = isClient ? faultsHook : snapshotState!.faults;
  const recentTransitions = isClient ? transitionsHook : snapshotState!.recentTransitions;
  const connectionStatus = isClient ? connectionStatusHook : snapshotState!.connectionStatus;

  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLiveMetrics = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getLiveMetrics();
      setLiveMetrics(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load live session metrics');
    } finally {
      setLoading(false);
    }
  }, []);

  // Re-fetch when live fault or transition events arrive (no polling loop)
  useEffect(() => {
    void fetchLiveMetrics();
  }, [fetchLiveMetrics, faults.length, recentTransitions.length]);

  const baselineAlarmsCount = useMemo(() => {
    if (!liveMetrics) return null;
    return liveMetrics.faults.filter((f) => Boolean(f.baseline_alarmed)).length;
  }, [liveMetrics]);

  const handleExportJson = () => {
    if (!liveMetrics) return;
    const blob = new Blob([JSON.stringify(liveMetrics, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chronyx-live-metrics-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const isReconnecting = connectionStatus === 'disconnected' || connectionStatus === 'error';
  const isMock = connectionStatus === 'mock';

  return (
    <LiquidGlassShell accent="emerald" speed={1.1} dimmed={isReconnecting}>
      {/* Liquid-Glass Header */}
      <GlassPanel tone="default" padding="p-4 sm:p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300">
                Verification Proof &amp; Benchmarks
              </span>
              {isMock ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-cyan-400/15 border border-cyan-300/45 text-cyan-200 shadow-[0_0_14px_rgba(61,214,245,0.22)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" aria-hidden="true" />
                  SIMULATED (MOCK)
                </span>
              ) : isReconnecting ? (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-amber-400/15 border border-amber-300/45 text-amber-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-300" aria-hidden="true" />
                  RECONNECTING
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-300/45 text-emerald-200">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
                  LIVE SESSION
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">Scoreboard</h2>
            <p className="text-sm text-slate-300">
              Empirical detection latency and timing-error measurements from this session
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void fetchLiveMetrics()}
              className="text-slate-200 hover:bg-white/10"
            >
              Refresh
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!liveMetrics}
              onClick={handleExportJson}
              className="bg-white/[0.08] border-white/20 text-white hover:bg-cyan-400/20 hover:border-cyan-300/45 hover:-translate-y-[1px]"
            >
              Export JSON
            </Button>
          </div>
        </div>
      </GlassPanel>

      {/* Methodology Disclosure Glass Strip */}
      <GlassPanel tone="default" padding="px-4 py-3">
        <div className="text-xs text-slate-200/90 leading-relaxed">
          <strong className="text-cyan-200">How this is measured:</strong> Live results below are
          measured directly in this session from the running verification pipeline. Ground truth is
          injected in software so detection latency and error at detection are computed against
          known injected offsets.
        </div>
      </GlassPanel>

      {/* Card A: Primary Proof Panel — Measured live in this session */}
      <div data-testid="scoreboard-live">
        <GlassPanel tone="cyan">
          <div className="space-y-5">
            <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-white/12">
              <div className="space-y-0.5">
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300">
                  Primary Evidence · Live Session
                </span>
                <h3 className="text-lg font-bold text-white">Measured live in this session</h3>
                <p className="text-xs text-slate-300/85">
                  Every injected fault recorded by the server with detection latency and error at
                  detection
                </p>
              </div>

              {/* Illuminated Summary Metric Tiles */}
              <div className="grid grid-cols-3 gap-2.5 shrink-0">
                <div className="px-3.5 py-2.5 rounded-xl bg-black/35 border border-cyan-300/30">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-cyan-200/80 block">
                    Detected
                  </span>
                  <span className="font-mono text-base font-bold text-cyan-200 tabular-nums">
                    {liveMetrics
                      ? `${liveMetrics.summary.detected}/${liveMetrics.summary.count}`
                      : '--'}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 rounded-xl bg-black/35 border border-white/15">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-300 block">
                    Median latency
                  </span>
                  <span className="font-mono text-base font-bold text-white tabular-nums">
                    {liveMetrics?.summary.median_latency_s !== null &&
                    liveMetrics?.summary.median_latency_s !== undefined
                      ? `${liveMetrics.summary.median_latency_s.toFixed(1)} s`
                      : '--'}
                  </span>
                </div>
                <div className="px-3.5 py-2.5 rounded-xl bg-black/35 border border-rose-300/25">
                  <span className="text-[10px] font-mono uppercase tracking-wider text-slate-300 flex items-center gap-1">
                    Baseline alarms
                    <InfoTip text="Count of alarms raised by the unverified baseline follower across recorded session faults." />
                  </span>
                  <span className="font-mono text-base font-bold text-rose-300 tabular-nums">
                    {baselineAlarmsCount !== null ? baselineAlarmsCount : '--'}
                  </span>
                </div>
              </div>
            </div>

            {error && liveMetrics && (
              <div className="p-3 rounded-xl bg-rose-500/18 border border-rose-300/40 text-xs text-rose-100 flex items-center justify-between gap-2">
                <span>Failed to refresh live metrics: {error}</span>
                <button
                  type="button"
                  onClick={() => void fetchLiveMetrics()}
                  className="underline font-semibold hover:text-white"
                >
                  Retry
                </button>
              </div>
            )}

            {loading && !liveMetrics ? (
              <div className="space-y-2">
                <Skeleton height={36} />
                <Skeleton height={36} />
                <Skeleton height={36} />
              </div>
            ) : error && !liveMetrics ? (
              <EmptyState
                title="Unable to load live session metrics"
                description={error}
                action={
                  <Button variant="primary" size="sm" onClick={() => void fetchLiveMetrics()}>
                    Retry
                  </Button>
                }
              />
            ) : !liveMetrics || liveMetrics.faults.length === 0 ? (
              <EmptyState
                title="No faults measured in this session yet"
                description="Trigger a scenario in Before vs After or inject a fault in the Red-Team Console to record live detection metrics."
                action={
                  <div className="flex items-center gap-2">
                    <Link
                      to="/compare"
                      className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-xl bg-cyan-400/20 text-cyan-100 border border-cyan-300/45 hover:bg-cyan-400/30 transition-colors"
                    >
                      Open Before vs After
                    </Link>
                    <Link
                      to="/redteam"
                      className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-xl bg-white/[0.08] text-white border border-white/20 hover:border-cyan-300/45 transition-colors"
                    >
                      Open Red-Team
                    </Link>
                  </div>
                }
              />
            ) : (
              <div className="overflow-x-auto rounded-xl border border-white/15 bg-black/35 backdrop-blur-md">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-white/12 bg-white/[0.05] text-[11px] font-mono uppercase tracking-wider text-slate-300">
                      <th className="py-3 pl-4 pr-4 font-medium">Node</th>
                      <th className="py-3 pr-4 font-medium">Fault Type</th>
                      <th className="py-3 pr-4 font-medium">Injected (UTC)</th>
                      <th className="py-3 pr-4 font-medium">Detection Time</th>
                      <th className="py-3 pr-4 font-medium text-right">Error at Detection</th>
                      <th className="py-3 pr-4 font-medium text-right">Peak True Error</th>
                      <th className="py-3 pr-4 font-medium text-right">Baseline Alarmed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/10">
                    {liveMetrics.faults.map((row) => (
                      <tr key={row.fault_id} className="hover:bg-white/[0.05] transition-colors">
                        <td className="py-3 pl-4 pr-4 font-semibold text-white">{row.node_name}</td>
                        <td className="py-3 pr-4">
                          <span className="font-mono text-[11px] px-2 py-0.5 rounded-md bg-cyan-400/15 border border-cyan-300/35 text-cyan-200">
                            {row.type}
                          </span>
                        </td>
                        <td className="py-3 pr-4 font-mono text-slate-300 tabular-nums">
                          {formatTimeUtc(row.injected_at_ms)}
                        </td>
                        <td className="py-3 pr-4 font-mono tabular-nums">
                          {row.detection_latency_s !== null ? (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-300/40 text-emerald-200">
                              {`${row.detection_latency_s.toFixed(1)} s`}
                            </span>
                          ) : (
                            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full bg-white/[0.06] border border-white/15 text-slate-300">
                              Not detected
                            </span>
                          )}
                        </td>
                        <td className="py-3 pr-4 font-mono text-cyan-100 text-right tabular-nums">
                          {formatSignedMs(row.error_at_detect_ms)}
                        </td>
                        <td className="py-3 pr-4 font-mono text-slate-300 text-right tabular-nums">
                          {formatSignedMs(row.peak_true_error_ms)}
                        </td>
                        <td className="py-3 pr-4 font-mono text-right">
                          <span
                            className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[11px] border ${
                              row.baseline_alarmed
                                ? 'bg-emerald-400/15 text-emerald-200 border-emerald-300/40'
                                : 'bg-rose-500/18 text-rose-200 border-rose-300/40'
                            }`}
                          >
                            {row.baseline_alarmed ? 'Yes' : 'No'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </GlassPanel>
      </div>

      {/* Card B: Benchmark (simulated noise) */}
      <BenchmarkCard />
    </LiquidGlassShell>
  );
}
