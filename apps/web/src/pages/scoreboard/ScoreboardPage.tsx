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
    <div className={`space-y-6${isReconnecting ? ' opacity-90 transition-opacity' : ''}`}>
      {/* Header strip */}
      <header className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 pb-4 border-b border-white/[0.08]">
        <div className="space-y-1.5">
          <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono">
            <span className="uppercase tracking-[0.14em] text-accent-cyan/90">
              Verification Proof &amp; Benchmarks
            </span>
            <span className="text-white/20">·</span>
            {isMock ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan">
                <span className="mc-live-dot h-1.5 w-1.5 rounded-full bg-accent-cyan" aria-hidden="true" />
                SIMULATED (MOCK)
              </span>
            ) : isReconnecting ? (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-trust-suspect/15 border border-trust-suspect/35 text-trust-suspect">
                <span className="h-1.5 w-1.5 rounded-full bg-trust-suspect" aria-hidden="true" />
                RECONNECTING
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-trust-trusted/15 border border-trust-trusted/35 text-trust-trusted">
                <span className="mc-live-dot h-1.5 w-1.5 rounded-full bg-trust-trusted" aria-hidden="true" />
                LIVE SESSION
              </span>
            )}
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Scoreboard</h2>
          <p className="text-sm text-muted">
            Empirical detection latency and timing-error measurements from this session
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void fetchLiveMetrics()}
          >
            Refresh
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={!liveMetrics}
            onClick={handleExportJson}
          >
            Export JSON
          </Button>
        </div>
      </header>

      {/* Methodology Disclosure */}
      <div className="mc-well px-4 py-3 rounded-[10px] text-xs text-muted leading-relaxed">
        <strong className="text-foreground font-semibold">How this is measured:</strong> Live results below are
        measured directly in this session from the running verification pipeline. Ground truth is
        injected in software so detection latency and error at detection are computed against
        known injected offsets.
      </div>

      {/* Card A: Primary Proof Panel — Measured live in this session */}
      <section
        data-testid="scoreboard-live"
        className="mc-panel-primary mc-ticks rounded-[14px] p-5 space-y-5"
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-4 pb-4 border-b border-white/[0.08]">
          <div className="space-y-0.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-accent-cyan/90">
              Primary Evidence · Live Session
            </span>
            <h3 className="text-lg font-semibold text-foreground">Measured live in this session</h3>
            <p className="text-xs text-muted">
              Every injected fault recorded by the server with detection latency and error at
              detection
            </p>
          </div>

          {/* Summary Metric Wells */}
          <div className="grid grid-cols-3 gap-2.5 shrink-0">
            <div className="mc-well px-3.5 py-2.5 rounded-[10px] border-accent-cyan/25">
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted block">
                Detected
              </span>
              <span className="font-mono text-base font-semibold text-accent-cyan tabular-nums">
                {liveMetrics
                  ? `${liveMetrics.summary.detected}/${liveMetrics.summary.count}`
                  : '--'}
              </span>
            </div>
            <div className="mc-well px-3.5 py-2.5 rounded-[10px]">
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted block">
                Median latency
              </span>
              <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                {liveMetrics?.summary.median_latency_s !== null &&
                  liveMetrics?.summary.median_latency_s !== undefined
                  ? `${liveMetrics.summary.median_latency_s.toFixed(1)} s`
                  : '--'}
              </span>
            </div>
            <div className="mc-well px-3.5 py-2.5 rounded-[10px] border-trust-untrusted/25">
              <span className="text-[10px] font-mono uppercase tracking-[0.1em] text-muted flex items-center gap-1">
                Baseline alarms
                <InfoTip text="Count of alarms raised by the unverified baseline follower across recorded session faults." />
              </span>
              <span className="font-mono text-base font-semibold text-trust-untrusted tabular-nums">
                {baselineAlarmsCount !== null ? baselineAlarmsCount : '--'}
              </span>
            </div>
          </div>
        </div>

        {error && liveMetrics && (
          <div className="p-3 rounded-[10px] bg-trust-untrusted/12 border border-trust-untrusted/35 text-xs text-red-100 flex items-center justify-between gap-2">
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
                  className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-[10px] bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/35 hover:bg-accent-cyan/25 transition-colors"
                >
                  Open Before vs After
                </Link>
                <Link
                  to="/redteam"
                  className="inline-flex items-center px-3.5 py-2 text-xs font-semibold rounded-[10px] bg-white/[0.06] text-foreground border border-white/15 hover:border-accent-cyan/35 transition-colors"
                >
                  Open Red-Team
                </Link>
              </div>
            }
          />
        ) : (
          <div className="mc-well overflow-x-auto rounded-[10px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] bg-white/[0.03] text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
                  <th className="py-2.5 pl-4 pr-4 font-medium">Node</th>
                  <th className="py-2.5 pr-4 font-medium">Fault Type</th>
                  <th className="py-2.5 pr-4 font-medium">Injected (UTC)</th>
                  <th className="py-2.5 pr-4 font-medium">Detection Time</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Error at Detection</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Peak True Error</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Baseline Alarmed</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {liveMetrics.faults.map((row) => (
                  <tr key={row.fault_id} className="hover:bg-white/[0.03] transition-colors">
                    <td className="py-2.5 pl-4 pr-4 font-semibold text-foreground">{row.node_name}</td>
                    <td className="py-2.5 pr-4">
                      <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-accent-cyan/10 border border-accent-cyan/25 text-accent-cyan">
                        {row.type}
                      </span>
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-muted tabular-nums">
                      {formatTimeUtc(row.injected_at_ms)}
                    </td>
                    <td className="py-2.5 pr-4 font-mono tabular-nums">
                      {row.detection_latency_s !== null ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-trust-trusted/15 border border-trust-trusted/30 text-trust-trusted">
                          {`${row.detection_latency_s.toFixed(1)} s`}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded bg-white/[0.05] border border-white/10 text-muted">
                          Not detected
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-foreground text-right tabular-nums">
                      {formatSignedMs(row.error_at_detect_ms)}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-muted text-right tabular-nums">
                      {formatSignedMs(row.peak_true_error_ms)}
                    </td>
                    <td className="py-2.5 pr-4 font-mono text-right">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] border ${
                          row.baseline_alarmed
                            ? 'bg-trust-trusted/15 text-trust-trusted border-trust-trusted/30'
                            : 'bg-trust-untrusted/15 text-trust-untrusted border-trust-untrusted/30'
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
      </section>

      {/* Card B: Benchmark (simulated noise) */}
      <BenchmarkCard />
    </div>
  );
}
