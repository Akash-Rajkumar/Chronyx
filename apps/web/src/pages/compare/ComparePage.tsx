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
  if (!activeFault) return null;
  const matchingMetric = liveMetrics?.faults.find((f) => f.fault_id === activeFault.id);
  if (matchingMetric) return matchingMetric.peak_true_error_ms;
  if (activeFault.error_at_detect_ms !== null) return activeFault.error_at_detect_ms;
  if (activeFault.params.offset_ms !== undefined) return activeFault.params.offset_ms;
  return null;
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

  useEffect(() => {
    void fetchLiveMetrics();
  }, [fetchLiveMetrics, faults.length, recentTransitions.length]);

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

  const activeFault = useMemo(
    () => faults.find((f) => f.status === 'active') ?? faults[faults.length - 1],
    [faults],
  );

  const activeFaultNode = useMemo(
    () => (activeFault ? nodes.find((n) => n.id === activeFault.node_id) : undefined),
    [activeFault, nodes],
  );

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

  const hasActiveFault = Boolean(activeFault && activeFault.status === 'active');

  return (
    <div
      className={`space-y-5 transition-opacity duration-[180ms] ease-out ${
        isReconnecting ? 'opacity-70' : 'opacity-100'
      }`}
    >
      {/* Top Operations Header + Compact Simulation Scenario Bar */}
      <div className="flex flex-col xl:flex-row xl:items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Before vs After Comparison
            </h2>
            {isMock ? (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-amber-500/12 border border-amber-400/30 text-amber-200">
                SIMULATED (MOCK)
              </span>
            ) : isReconnecting ? (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-amber-500/12 border border-amber-400/30 text-trust-suspect">
                RECONNECTING
              </span>
            ) : (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-emerald-500/12 border border-emerald-400/30 text-trust-trusted">
                LIVE TELEMETRY
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Same injected fault, side-by-side: unverified baseline vs Chronyx verification layer
          </p>
        </div>

        <div className="flex flex-col items-start xl:items-end gap-1.5">
          <span className="text-[11px] font-mono text-muted">Simulation Scenario</span>
          <div
            data-testid="scenario-bar"
            className="mc-well inline-flex flex-wrap items-center gap-1.5 p-1.5 rounded-[10px]"
          >
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
      </div>

      {scenarioError && (
        <div className="mc-well border-rose-400/30 border-l-2 border-l-trust-quarantined rounded-[10px] px-4 py-3 text-xs text-rose-100 flex items-center justify-between gap-3">
          <span>Scenario request failed: {scenarioError}</span>
          <button
            type="button"
            onClick={() => setScenarioError(null)}
            className="underline font-medium hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Ground-Truth & Cluster Context Strip */}
      <div
        className={`mc-well rounded-[10px] px-4 py-2.5 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs ${
          hasActiveFault ? 'border-l-2 border-l-trust-quarantined' : ''
        }`}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <span
            className={`h-2 w-2 rounded-full ${
              hasActiveFault ? 'bg-trust-quarantined' : 'bg-muted/50'
            }`}
            aria-hidden="true"
          />
          <span className="font-mono text-[11px] text-muted">Injected (ground truth):</span>
          {hasActiveFault && activeFault ? (
            <span className="font-mono text-xs font-semibold text-foreground tabular-nums">
              {activeFaultNode?.name ?? activeFault.node_id.slice(0, 8)},{' '}
              {formatSignedMs(injectedBadgeValue)}
            </span>
          ) : (
            <span className="font-mono text-xs text-muted">No active fault</span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-[11px] text-muted tabular-nums">
          <span>{nodes.length} nodes</span>
          {network && (
            <>
              <span className="text-white/20">·</span>
              <span className="text-trust-trusted">{network.trusted} trusted</span>
              {network.suspect > 0 && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-trust-suspect">{network.suspect} suspect</span>
                </>
              )}
              {network.quarantined > 0 && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="text-trust-quarantined">{network.quarantined} quarantined</span>
                </>
              )}
            </>
          )}
        </div>
      </div>

      {/* Split Screen: Unverified Baseline vs Chronyx Verified */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 items-stretch">
        {/* Left: Unverified Baseline */}
        <div
          data-testid="compare-left"
          className="mc-panel border-rose-400/20 border-t-2 border-t-trust-quarantined/75 rounded-[14px] p-5 flex flex-col justify-between gap-4"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-mono text-trust-quarantined block">
                  Unverified Baseline
                </span>
                <h3 className="text-base font-semibold text-foreground flex items-center gap-1.5 mt-0.5">
                  <span>{baseline?.label ?? 'Baseline unavailable'}</span>
                  <InfoTip text="A naive sync follower trusts its input clock without cluster cross-checks or anomaly alarms." />
                </h3>
                <p className="text-xs text-muted">Unverified baseline (alarm is always false)</p>
              </div>
              <span className="inline-flex items-center px-2.5 py-1 rounded-[6px] text-[11px] font-mono border bg-trust-quarantined/12 text-trust-quarantined border-trust-quarantined/35 shrink-0">
                No alarm raised
              </span>
            </div>

            <div className="mc-well rounded-[10px] px-4 py-3 flex items-center justify-between">
              <div>
                <span className="text-xs font-medium text-muted flex items-center gap-1">
                  Cluster-time error
                  <InfoTip text="Mean timing error carried by the naive baseline across all nodes." />
                </span>
                <span className="text-[11px] text-muted/75 block mt-0.5">
                  Propagated silently into observations
                </span>
              </div>
              <span className="font-mono text-2xl font-semibold text-trust-quarantined tabular-nums">
                {baseline ? formatSignedMs(baseline.cluster_time_error_ms) : '--'}
              </span>
            </div>

            <div className="space-y-2.5 pt-1">
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
                        <span className="font-medium text-foreground truncate">
                          {nodeMeta?.name ?? entry.node_id.slice(0, 8)}
                        </span>
                        <span className="font-mono text-muted tabular-nums">
                          {formatSignedMs(entry.followed_error_ms)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                        <div
                          className="h-full bg-trust-quarantined/85 rounded-full transition-[width] duration-200"
                          style={{ width: `${widthPct}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted py-3 text-center">
                  No baseline node readings available.
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Right: Chronyx Verified */}
        <div
          data-testid="compare-right"
          className="mc-panel-primary mc-ticks border-t-2 border-t-accent-cyan/75 rounded-[14px] p-5 flex flex-col justify-between gap-4"
        >
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <span className="text-[11px] font-mono text-accent-cyan block">
                  Verification Layer
                </span>
                <h3 className="text-base font-semibold text-foreground mt-0.5">Chronyx Verified</h3>
                <p className="text-xs text-muted">
                  Cluster consensus, anomaly detection, and quarantine
                </p>
              </div>
              <div className="text-right font-mono tabular-nums">
                <div className="text-[11px] text-muted font-sans">Network Health</div>
                <div className="text-xl font-semibold text-accent-cyan leading-tight">
                  {network ? `${network.score}%` : '--'}
                </div>
              </div>
            </div>

            <div className="mc-well rounded-[10px] divide-y divide-white/[0.06]">
              {sortedNodes.map((node) => {
                const assessment = assessments[node.id];
                const confPct = assessment ? Math.round(assessment.confidence * 100) : null;
                return (
                  <div
                    key={node.id}
                    className="flex items-center justify-between gap-3 px-3.5 py-2.5 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-foreground truncate">{node.name}</span>
                      <span className="text-[10px] font-mono text-muted shrink-0">
                        · {node.kind === 'virtual' ? 'Simulated' : 'Real'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {assessment ? (
                        <>
                          <StateChip state={assessment.state} size="sm" />
                          <div className="flex items-center gap-2">
                            <div className="hidden sm:block w-14 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                              <div
                                className="h-full rounded-full bg-accent-cyan/85"
                                style={{ width: `${confPct ?? 0}%` }}
                              />
                            </div>
                            <span className="font-mono text-foreground tabular-nums w-9 text-right">
                              {confPct}%
                            </span>
                          </div>
                        </>
                      ) : (
                        <span className="text-muted font-mono">Unassessed</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Shared Timing Error Timeline Instrument Panel */}
      <div data-testid="compare-chart" className="mc-panel rounded-[14px] p-5 space-y-3.5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">
              Shared Timing Error Timeline (ms)
            </h3>
            <p className="text-xs text-muted">
              Real-time comparison of ground-truth fault, naive baseline, and Chronyx estimate
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-4 text-[11px] font-mono">
            <span className="inline-flex items-center gap-1.5 text-muted">
              <span className="h-0.5 w-3.5 bg-slate-300 inline-block" aria-hidden="true" />
              Injected (ground truth)
            </span>
            <span className="inline-flex items-center gap-1.5 text-trust-quarantined">
              <span className="h-0.5 w-3.5 bg-trust-quarantined inline-block" aria-hidden="true" />
              Baseline error
            </span>
            <span className="inline-flex items-center gap-1.5 text-accent-cyan">
              <span className="h-0.5 w-3.5 bg-accent-cyan inline-block" aria-hidden="true" />
              Chronyx estimate
            </span>
            {quarantineMarkerLabel && (
              <span className="px-2 py-0.5 rounded-[6px] bg-trust-quarantined/15 border border-trust-quarantined/35 text-trust-quarantined">
                Quarantine at {quarantineMarkerLabel}
              </span>
            )}
          </div>
        </div>

        <div className="mc-well rounded-[10px] p-3">
          {chartPoints.length > 0 ? (
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartPoints} margin={{ top: 10, right: 18, left: 4, bottom: 2 }}>
                  <CartesianGrid stroke="rgba(148,163,184,0.12)" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="label"
                    stroke="#9FB0D6"
                    tick={{ fill: '#9FB0D6', fontSize: 11 }}
                    tickLine={{ stroke: '#1F2B4A' }}
                  />
                  <YAxis
                    stroke="#9FB0D6"
                    tick={{ fill: '#9FB0D6', fontSize: 11 }}
                    tickLine={{ stroke: '#1F2B4A' }}
                    unit=" ms"
                  />
                  <ReferenceLine y={0} stroke="rgba(148,163,184,0.3)" strokeWidth={1} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'rgba(8, 14, 28, 0.94)',
                      borderColor: 'rgba(61, 214, 245, 0.35)',
                      borderRadius: '10px',
                      fontSize: '12px',
                      color: '#E8EEFF',
                    }}
                  />
                  {quarantineMarkerLabel && (
                    <ReferenceLine
                      x={quarantineMarkerLabel}
                      stroke="#FF5C5C"
                      strokeWidth={1.8}
                      strokeDasharray="4 4"
                      label={{
                        value: 'Quarantined',
                        fill: '#FF5C5C',
                        fontSize: 11,
                        position: 'insideTopRight',
                      }}
                    />
                  )}
                  <Line
                    type="monotone"
                    dataKey="injected_ms"
                    name="Injected (ground truth)"
                    stroke="#CBD5E1"
                    strokeWidth={1.8}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="baseline_ms"
                    name={baseline?.label ?? 'Baseline'}
                    stroke="#FF5C5C"
                    strokeWidth={2.2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="chronyx_ms"
                    name="Chronyx estimate"
                    stroke="#3DD6F5"
                    strokeWidth={2.2}
                    dot={false}
                    isAnimationActive={false}
                    connectNulls
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-12 text-center text-xs text-muted font-mono">
              Waiting for live assessment ticks to plot the shared timeline.
            </div>
          )}
        </div>
      </div>

      {/* Bottom Evidence Summary Strip */}
      <div
        data-testid="metrics-strip"
        className="mc-panel rounded-[12px] p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
      >
        <div className="grid grid-cols-1 sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-white/[0.08] flex-1">
          <div className="pb-2 sm:pb-0 sm:pr-4">
            <div className="text-[11px] text-muted">Time to detect</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-accent-cyan tabular-nums">
              {metricsLoading
                ? 'Loading...'
                : latestFaultMetric?.detection_latency_s !== null &&
                    latestFaultMetric?.detection_latency_s !== undefined
                  ? `${latestFaultMetric.detection_latency_s.toFixed(1)} s`
                  : '--'}
            </div>
          </div>
          <div className="py-2 sm:py-0 sm:px-4">
            <div className="text-[11px] text-muted">Error at detection</div>
            <div className="mt-0.5 font-mono text-base font-semibold text-foreground tabular-nums">
              {latestFaultMetric?.error_at_detect_ms !== null &&
              latestFaultMetric?.error_at_detect_ms !== undefined
                ? formatSignedMs(latestFaultMetric.error_at_detect_ms)
                : '--'}
            </div>
          </div>
          <div className="pt-2 sm:pt-0 sm:pl-4">
            <div className="text-[11px] text-muted flex items-center gap-1">
              Baseline alarms
              <InfoTip text="Naive clock followers do not raise timing-integrity alarms." />
            </div>
            <div className="mt-0.5 font-mono text-base font-semibold text-trust-quarantined tabular-nums">
              {liveMetrics ? liveMetrics.faults.filter((f) => f.baseline_alarmed).length : 0}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3 shrink-0">
          {metricsError && (
            <button
              type="button"
              onClick={() => void fetchLiveMetrics()}
              className="text-xs text-trust-suspect underline hover:text-foreground"
            >
              Metrics unavailable (retry)
            </button>
          )}
          <Link
            to="/science"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-[10px] text-xs font-semibold bg-accent-cyan/[0.15] text-accent-cyan border border-accent-cyan/40 hover:bg-accent-cyan/[0.22] transition-colors duration-[180ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
          >
            See what this does to the science →
          </Link>
        </div>
      </div>
    </div>
  );
}
