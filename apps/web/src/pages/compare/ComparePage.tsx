import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type {
  Assessment,
  BaselineState,
  DemoScenarioName,
  Fault,
  LiveMetrics,
  NetworkHealth,
  NodeInfo,
  Transition,
} from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import {
  useAssessments,
  useConnectionStatus,
  useDashboardStore,
  useFaults,
  useIsLoading,
  useLastSeenMs,
  useNetworkHealth,
  useNodes,
  useRecentTransitions,
  useStoreError,
} from '../../state/useDashboardStore.js';
import { Button } from '../../ui/Button.js';
import { Card } from '../../ui/Card.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { InfoTip } from '../../ui/InfoTip.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { StateChip } from '../../ui/StateChip.js';

interface ComparePoint {
  t_ms: number;
  label: string;
  injected_ms: number | null;
  baseline_ms: number | null;
  chronyx_ms: number | null;
  quarantine_marker: boolean;
}

const MAX_CHART_POINTS = 120;

const SCENARIO_BUTTONS: ReadonlyArray<{ name: DemoScenarioName; label: string }> = [
  { name: 'calm', label: 'Calm' },
  { name: 'jump', label: 'Jump' },
  { name: 'slow_drag', label: 'Slow drag' },
  { name: 'gnss_spoof', label: 'GNSS spoof' },
];

function formatTimeLabel(tMs: number): string {
  const d = new Date(tMs);
  return d.toISOString().slice(11, 19);
}

function formatSignedMs(val: number | null | undefined): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '--';
  const sign = val >= 0 ? '+' : '';
  return `${sign}${val.toFixed(2)} ms`;
}

function pickInjectedGroundTruthMs(
  activeFault: Fault | undefined,
  liveMetrics: LiveMetrics | null,
): number | null {
  if (!activeFault || activeFault.status !== 'active') return 0;
  const matchingMetric = liveMetrics?.faults.find((f) => f.fault_id === activeFault.id);
  if (matchingMetric) return matchingMetric.peak_true_error_ms;
  if (activeFault.error_at_detect_ms !== null) return activeFault.error_at_detect_ms;
  if (activeFault.params.offset_ms !== undefined) return activeFault.params.offset_ms;
  return 0;
}

function pickChronyxEstimateMs(
  assessments: Record<string, Assessment>,
  activeFault: Fault | undefined,
): number | null {
  if (activeFault && assessments[activeFault.node_id]) {
    return assessments[activeFault.node_id]!.error_est_ms;
  }
  const values = Object.values(assessments);
  if (values.length === 0) return null;
  let maxAbs = values[0]!;
  for (const a of values) {
    if (Math.abs(a.error_est_ms) > Math.abs(maxAbs.error_est_ms)) {
      maxAbs = a;
    }
  }
  return maxAbs.error_est_ms;
}

/**
 * Before vs After Page (The Hero Page - Part G4.3)
 * Owned by Person 4 (P4-T2)
 */
export function ComparePage() {
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const networkHook = useNetworkHealth();
  const nodesHook = useNodes();
  const assessmentsHook = useAssessments();
  const faultsHook = useFaults();
  const baselineHook = useDashboardStore((s) => s.baseline);
  const transitionsHook = useRecentTransitions();
  const isLoadingHook = useIsLoading();
  const storeErrorHook = useStoreError();
  const connectionStatusHook = useConnectionStatus();
  const lastSeenMsHook = useLastSeenMs();

  const isClient = typeof window !== 'undefined';
  const snapshotState = isClient ? null : useDashboardStore.getState();

  const network: NetworkHealth | null = isClient ? networkHook : snapshotState!.network;
  const nodes: NodeInfo[] = isClient ? nodesHook : snapshotState!.nodes;
  const assessments: Record<string, Assessment> = isClient
    ? assessmentsHook
    : snapshotState!.assessments;
  const faults: Fault[] = isClient ? faultsHook : snapshotState!.faults;
  const baseline: BaselineState | null = isClient ? baselineHook : snapshotState!.baseline;
  const recentTransitions: Transition[] = isClient
    ? transitionsHook
    : snapshotState!.recentTransitions;
  const isLoading: boolean = isClient ? isLoadingHook : snapshotState!.isLoading;
  const storeError: string | null = isClient ? storeErrorHook : snapshotState!.error;
  const connectionStatus = isClient ? connectionStatusHook : snapshotState!.connectionStatus;
  const lastSeenMs = isClient ? lastSeenMsHook : snapshotState!.lastSeenMs;

  const [liveMetrics, setLiveMetrics] = useState<LiveMetrics | null>(null);
  const [metricsLoading, setMetricsLoading] = useState<boolean>(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  const [activeScenario, setActiveScenario] = useState<DemoScenarioName | null>(null);
  const [scenarioPending, setScenarioPending] = useState<DemoScenarioName | null>(null);
  const [scenarioError, setScenarioError] = useState<string | null>(null);

  const [chartPoints, setChartPoints] = useState<ComparePoint[]>([]);
  const lastQuarantineAtRef = useRef<number | null>(null);

  const fetchLiveMetrics = useCallback(async () => {
    setMetricsLoading(true);
    setMetricsError(null);
    try {
      const data = await api.getLiveMetrics();
      setLiveMetrics(data);
    } catch (err) {
      setMetricsError(err instanceof Error ? err.message : 'Failed to load live metrics');
    } finally {
      setMetricsLoading(false);
    }
  }, []);

  const activeFault = useMemo(
    () => faults.find((f) => f.status === 'active') ?? faults[faults.length - 1],
    [faults],
  );

  const activeFaultNode = useMemo(
    () => (activeFault ? nodes.find((n) => n.id === activeFault.node_id) : undefined),
    [activeFault, nodes],
  );

  const handleScenario = async (name: DemoScenarioName) => {
    setScenarioPending(name);
    setScenarioError(null);
    try {
      await api.triggerScenario(name);
      setActiveScenario(name);
      await fetchLiveMetrics();
    } catch (err) {
      setScenarioError(err instanceof Error ? err.message : `Failed to trigger ${name}`);
    } finally {
      setScenarioPending(null);
    }
  };

  useEffect(() => {
    void fetchLiveMetrics();
  }, [fetchLiveMetrics, faults.length, recentTransitions.length, activeFault?.detected_at_ms]);

  const latestQuarantine = useMemo(
    () => recentTransitions.find((t) => t.to === 'quarantined'),
    [recentTransitions],
  );

  useEffect(() => {
    if (!lastSeenMs && nodes.length === 0) return;
    const tMs = lastSeenMs ?? Date.now();
    const injectedMs = pickInjectedGroundTruthMs(activeFault, liveMetrics);
    const baselineMs = baseline ? baseline.cluster_time_error_ms : null;
    const chronyxMs = pickChronyxEstimateMs(assessments, activeFault);

    const hasNewQuarantine =
      latestQuarantine !== undefined && latestQuarantine.at_ms !== lastQuarantineAtRef.current;
    if (hasNewQuarantine && latestQuarantine) {
      lastQuarantineAtRef.current = latestQuarantine.at_ms;
    }

    setChartPoints((prev) => {
      const next: ComparePoint = {
        t_ms: tMs,
        label: formatTimeLabel(tMs),
        injected_ms: injectedMs,
        baseline_ms: baselineMs,
        chronyx_ms: chronyxMs,
        quarantine_marker: hasNewQuarantine,
      };
      return [...prev.slice(-(MAX_CHART_POINTS - 1)), next];
    });
  }, [lastSeenMs, nodes.length, activeFault, liveMetrics, baseline, assessments, latestQuarantine]);

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  const latestFaultMetric = liveMetrics?.faults[0] ?? null;
  const injectedBadgeValue = pickInjectedGroundTruthMs(activeFault, liveMetrics);
  const isReconnecting = connectionStatus === 'disconnected' || connectionStatus === 'error';
  const isMock = connectionStatus === 'mock';

  const quarantineMarkerLabel = useMemo(() => {
    const marked = chartPoints.find((p) => p.quarantine_marker);
    return marked ? marked.label : null;
  }, [chartPoints]);

  if (isLoading && nodes.length === 0 && !baseline) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton width={260} height={32} />
          <Skeleton width={320} height={34} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton height={220} />
          <Skeleton height={220} />
        </div>
        <Skeleton height={240} />
        <Skeleton height={56} />
      </div>
    );
  }

  if (storeError && nodes.length === 0 && !baseline) {
    return (
      <EmptyState
        title="Unable to load comparison telemetry"
        description={storeError}
        action={
          <Button variant="primary" size="sm" onClick={() => void fetchLiveMetrics()}>
            Retry
          </Button>
        }
      />
    );
  }

  if (nodes.length === 0 && !baseline) {
    return (
      <EmptyState
        title="No observatory nodes online yet"
        description="Start the server or join a browser node to compare the naive baseline against Chronyx."
        action={
          <Link
            to="/join"
            className="inline-flex items-center px-3 py-1.5 text-xs font-medium rounded-lg bg-accent-cyan/20 text-accent-cyan border border-accent-cyan/40 hover:bg-accent-cyan/30"
          >
            Join as a node
          </Link>
        }
      />
    );
  }

  const maxBaselineBar = Math.max(
    1,
    ...(baseline?.per_node.map((n) => Math.abs(n.followed_error_ms)) ?? [1]),
  );

  return (
    <div className={`space-y-6 transition-opacity ${isReconnecting ? 'opacity-65' : 'opacity-100'}`}>
      {/* Top Bar: Title + Scenario Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">
              Before vs After Comparison
            </h2>
            {isMock && (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan">
                SIMULATED (MOCK)
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Same injected fault, side-by-side: unverified baseline vs Chronyx verification layer
          </p>
        </div>

        <div data-testid="scenario-bar" className="flex flex-wrap items-center gap-2">
          {SCENARIO_BUTTONS.map((btn) => {
            const isSelected = activeScenario === btn.name;
            const isBusy = scenarioPending === btn.name;
            return (
              <Button
                key={btn.name}
                variant={isSelected ? 'primary' : 'secondary'}
                size="sm"
                loading={isBusy}
                disabled={scenarioPending !== null}
                onClick={() => void handleScenario(btn.name)}
              >
                {btn.label}
              </Button>
            );
          })}
        </div>
      </div>

      {scenarioError && (
        <div className="p-3 rounded-lg bg-trust-quarantined/10 border border-trust-quarantined/30 text-xs text-trust-quarantined flex items-center justify-between">
          <span>Scenario request failed: {scenarioError}</span>
          <button
            type="button"
            onClick={() => setScenarioError(null)}
            className="underline hover:opacity-80"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Centre Ground-Truth Badge */}
      <div className="flex justify-center">
        <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border text-xs font-mono">
          <span className="text-muted">Injected (ground truth):</span>
          {activeFault && activeFault.status === 'active' ? (
            <span className="text-foreground font-semibold tabular-nums">
              {activeFaultNode?.name ?? activeFault.node_id.slice(0, 8)},{' '}
              {formatSignedMs(injectedBadgeValue)}
            </span>
          ) : (
            <span className="text-muted">No active fault</span>
          )}
        </div>
      </div>

      {/* Split Screen: Left Baseline vs Right Chronyx */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Left: Baseline */}
        <div data-testid="compare-left">
          <Card className="space-y-4 h-full">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <span>{baseline?.label ?? 'Baseline unavailable'}</span>
                  <InfoTip text="A naive sync follower trusts its input clock without cluster cross-checks or anomaly alarms." />
                </h3>
                <p className="text-xs text-muted">Unverified baseline (alarm is always false)</p>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-mono border bg-muted/10 text-muted border-border">
                No alarm raised
              </span>
            </div>

            <div className="flex items-baseline justify-between border-t border-border/60 pt-3">
              <span className="text-xs text-muted flex items-center gap-1">
                Cluster-time error
                <InfoTip text="Mean timing error carried by the naive baseline across all nodes." />
              </span>
              <span className="font-mono text-2xl font-bold text-trust-quarantined tabular-nums">
                {baseline ? formatSignedMs(baseline.cluster_time_error_ms) : '--'}
              </span>
            </div>

            <div className="space-y-2">
              {baseline && baseline.per_node.length > 0 ? (
                baseline.per_node.map((entry) => {
                  const nodeMeta = nodes.find((n) => n.id === entry.node_id);
                  const widthPct = Math.min(
                    100,
                    (Math.abs(entry.followed_error_ms) / maxBaselineBar) * 100,
                  );
                  return (
                    <div key={entry.node_id} className="space-y-1">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium text-foreground">
                          {nodeMeta?.name ?? entry.node_id.slice(0, 8)}
                        </span>
                        <span className="font-mono text-muted tabular-nums">
                          {formatSignedMs(entry.followed_error_ms)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-border/60 overflow-hidden">
                        <div
                          className="h-full bg-trust-quarantined/80 rounded-full"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted">No baseline node readings available.</p>
              )}
            </div>
          </Card>
        </div>

        {/* Right: Chronyx */}
        <div data-testid="compare-right">
          <Card className="space-y-4 h-full">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-accent-cyan">Chronyx Verified</h3>
                <p className="text-xs text-muted">
                  Cluster consensus, anomaly detection, and quarantine
                </p>
              </div>
              <div className="text-right">
                <div className="text-[11px] text-muted">Network Health</div>
                <div className="font-mono text-xl font-bold text-accent-cyan tabular-nums">
                  {network ? `${network.score}%` : '--'}
                </div>
              </div>
            </div>

            <div className="border-t border-border/60 pt-3 space-y-2">
              {sortedNodes.map((node) => {
                const assessment = assessments[node.id];
                return (
                  <div
                    key={node.id}
                    className="flex items-center justify-between gap-2 py-1.5 px-2.5 rounded-lg bg-background/50 border border-border/60 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">{node.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-card border border-border text-muted">
                        {node.kind === 'virtual' ? 'Simulated' : 'Real'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {assessment ? (
                        <>
                          <StateChip state={assessment.state} size="sm" />
                          <span className="font-mono text-muted tabular-nums w-16 text-right">
                            {Math.round(assessment.confidence * 100)}%
                          </span>
                        </>
                      ) : (
                        <span className="text-muted font-mono">Unassessed</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>
        </div>
      </div>

      {/* Shared Line Chart */}
      <div data-testid="compare-chart">
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-foreground">
                Shared Timing Error Timeline (ms)
              </h3>
              <p className="text-xs text-muted">
                Injected ground truth (grey), Baseline error (red), Chronyx estimate (cyan)
              </p>
            </div>
            {quarantineMarkerLabel && (
              <span className="text-[11px] font-mono text-trust-quarantined">
                Quarantine at {quarantineMarkerLabel}
              </span>
            )}
          </div>

          {chartPoints.length > 0 ? (
            <div className="h-60 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPoints} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                  <CartesianGrid stroke="#1F2B4A" strokeDasharray="3 3" />
                  <XAxis dataKey="label" stroke="#9FB0D6" fontSize={11} />
                  <YAxis stroke="#9FB0D6" fontSize={11} unit=" ms" />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: '#121A2E',
                      borderColor: '#1F2B4A',
                      borderRadius: '8px',
                      fontSize: '12px',
                    }}
                  />
                  {quarantineMarkerLabel && (
                    <ReferenceLine
                      x={quarantineMarkerLabel}
                      stroke="#FF5C5C"
                      strokeDasharray="4 4"
                      label={{ value: 'Quarantined', fill: '#FF5C5C', fontSize: 10 }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="injected_ms"
                    name="Injected (ground truth)"
                    stroke="#9FB0D6"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="baseline_ms"
                    name={baseline?.label ?? 'Baseline'}
                    stroke="#FF5C5C"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="chronyx_ms"
                    name="Chronyx estimate"
                    stroke="#3DD6F5"
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-muted">
              Waiting for live assessment ticks to plot the shared timeline.
            </div>
          )}
        </Card>
      </div>

      {/* Bottom Metrics Strip */}
      <div data-testid="metrics-strip">
        <Card className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-6">
            <div>
              <span className="text-muted">Time to detect: </span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {metricsLoading
                  ? 'Loading...'
                  : (latestFaultMetric?.detection_latency_s ?? activeFault?.detection_latency_s) !== null &&
                    (latestFaultMetric?.detection_latency_s ?? activeFault?.detection_latency_s) !== undefined
                    ? `${(latestFaultMetric?.detection_latency_s ?? activeFault?.detection_latency_s)!.toFixed(1)} s`
                    : '--'}
              </span>
            </div>
            <div>
              <span className="text-muted">Error at detection: </span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {(latestFaultMetric?.error_at_detect_ms ?? activeFault?.error_at_detect_ms) !== null &&
                  (latestFaultMetric?.error_at_detect_ms ?? activeFault?.error_at_detect_ms) !== undefined
                  ? formatSignedMs(latestFaultMetric?.error_at_detect_ms ?? activeFault?.error_at_detect_ms)
                  : '--'}
              </span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-muted">Baseline alarms: </span>
              <span className="font-mono font-semibold text-foreground tabular-nums">
                {liveMetrics
                  ? liveMetrics.faults.filter((f) => f.baseline_alarmed).length
                  : 0}
              </span>
              <InfoTip text="Naive clock followers do not raise timing-integrity alarms." />
            </div>
            {metricsError && (
              <button
                type="button"
                onClick={() => void fetchLiveMetrics()}
                className="text-trust-suspect underline hover:opacity-80"
              >
                Metrics unavailable (retry)
              </button>
            )}
          </div>

          <Link
            to="/science"
            className="font-medium text-accent-cyan hover:underline shrink-0"
          >
            See what this does to the science →
          </Link>
        </Card>
      </div>
    </div>
  );
}
