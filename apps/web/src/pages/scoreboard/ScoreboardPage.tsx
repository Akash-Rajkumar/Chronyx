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
import { Card } from '../../ui/Card.js';
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
    <div className={`space-y-6 transition-opacity ${isReconnecting ? 'opacity-65' : 'opacity-100'}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Scoreboard</h2>
            {isMock && (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan">
                SIMULATED (MOCK)
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Empirical detection latency and timing-error measurements from this session
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => void fetchLiveMetrics()}>
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
      </div>

      {/* How this is measured note */}
      <div className="bg-card/60 border border-border px-4 py-3 rounded-lg text-xs text-muted">
        <strong className="text-foreground">How this is measured:</strong> Live results below are
        measured directly in this session from the running verification pipeline. Ground truth is
        injected in software so detection latency and error at detection are computed against known
        injected offsets.
      </div>

      {/* Card A: Measured live in this session */}
      <div data-testid="scoreboard-live">
        <Card className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Measured live in this session
              </h3>
              <p className="text-xs text-muted">
                Every injected fault recorded by the server with detection latency and error at
                detection
              </p>
            </div>

            {/* Summary Metrics */}
            <div className="flex flex-wrap items-center gap-4 text-xs">
              <div className="px-2.5 py-1.5 rounded-lg bg-background/60 border border-border">
                <span className="text-muted">Detected: </span>
                <span className="font-mono font-semibold text-accent-cyan tabular-nums">
                  {liveMetrics
                    ? `${liveMetrics.summary.detected}/${liveMetrics.summary.count}`
                    : '--'}
                </span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-background/60 border border-border">
                <span className="text-muted">Median latency: </span>
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {liveMetrics?.summary.median_latency_s !== null &&
                  liveMetrics?.summary.median_latency_s !== undefined
                    ? `${liveMetrics.summary.median_latency_s.toFixed(1)} s`
                    : '--'}
                </span>
              </div>
              <div className="px-2.5 py-1.5 rounded-lg bg-background/60 border border-border flex items-center gap-1">
                <span className="text-muted">Baseline alarms: </span>
                <span className="font-mono font-semibold text-foreground tabular-nums">
                  {baselineAlarmsCount !== null ? baselineAlarmsCount : '--'}
                </span>
                <InfoTip text="Count of alarms raised by the unverified baseline follower across recorded session faults." />
              </div>
            </div>
          </div>

          {error && liveMetrics && (
            <div className="p-2.5 rounded-lg bg-trust-quarantined/10 border border-trust-quarantined/30 text-xs text-trust-quarantined flex items-center justify-between">
              <span>Failed to refresh live metrics: {error}</span>
              <button
                type="button"
                onClick={() => void fetchLiveMetrics()}
                className="underline hover:opacity-80"
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
                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/40 hover:bg-accent-cyan/30"
                  >
                    Open Before vs After
                  </Link>
                  <Link
                    to="/redteam"
                    className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-card text-foreground border border-border hover:border-accent-cyan/40"
                  >
                    Open Red-Team
                  </Link>
                </div>
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th className="py-2 pr-4 font-medium">Node</th>
                    <th className="py-2 pr-4 font-medium">Fault Type</th>
                    <th className="py-2 pr-4 font-medium">Injected (UTC)</th>
                    <th className="py-2 pr-4 font-medium">Detection Time</th>
                    <th className="py-2 pr-4 font-medium">Error at Detection</th>
                    <th className="py-2 pr-4 font-medium">Peak True Error</th>
                    <th className="py-2 font-medium">Baseline Alarmed</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/50">
                  {liveMetrics.faults.map((row) => (
                    <tr key={row.fault_id} className="hover:bg-background/40">
                      <td className="py-2.5 pr-4 font-medium text-foreground">{row.node_name}</td>
                      <td className="py-2.5 pr-4 font-mono text-accent-cyan">{row.type}</td>
                      <td className="py-2.5 pr-4 font-mono text-muted tabular-nums">
                        {formatTimeUtc(row.injected_at_ms)}
                      </td>
                      <td className="py-2.5 pr-4 font-mono tabular-nums">
                        {row.detection_latency_s !== null ? (
                          <span className="text-trust-trusted">
                            {`${row.detection_latency_s.toFixed(1)} s`}
                          </span>
                        ) : (
                          <span className="text-muted">Not detected</span>
                        )}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-foreground tabular-nums">
                        {formatSignedMs(row.error_at_detect_ms)}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-muted tabular-nums">
                        {formatSignedMs(row.peak_true_error_ms)}
                      </td>
                      <td className="py-2.5 font-mono text-muted">
                        {row.baseline_alarmed ? 'Yes' : 'No'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {/* Card B: Benchmark (simulated noise) */}
      <BenchmarkCard />
    </div>
  );
}
