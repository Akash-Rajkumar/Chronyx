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
import { GlassPanel, LiquidGlassShell } from '../../present/LiquidGlass.js';

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
    <LiquidGlassShell accent="cyan" speed={1.2} dimmed={isReconnecting}>
      {/* Top Bar: Liquid-Glass Header + Illuminated Scenario Chips */}
      <GlassPanel tone="default" padding="p-4 sm:p-5">
        <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-cyan-300/90">
                Timing Verification · Side-by-Side
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
                <span className="inline-flex items-center gap-1.5 text-[10px] font-mono font-semibold px-2.5 py-0.5 rounded-full bg-emerald-400/15 border border-emerald-300/45 text-emerald-200 shadow-[0_0_14px_rgba(16,185,129,0.22)]">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden="true" />
                  LIVE TELEMETRY
                </span>
              )}
            </div>
            <h2 className="text-2xl font-bold tracking-tight text-white">
              Before vs After Comparison
            </h2>
            <p className="text-sm text-slate-300">
              Same injected fault, side-by-side: unverified baseline vs Chronyx verification layer
            </p>
          </div>

          <div className="flex flex-col items-start xl:items-end gap-1.5">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-slate-300/80">
              Simulation Controls
            </span>
            <div
              data-testid="scenario-bar"
              className="inline-flex flex-wrap items-center gap-1.5 p-1.5 rounded-xl backdrop-blur-md bg-white/[0.05] border border-white/15 shadow-[inset_0_1px_0_rgba(255,255,255,0.14)]"
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
                    className={`transition-all hover:-translate-y-[1px] ${
                      isSelected
                        ? 'shadow-[0_0_18px_rgba(61,214,245,0.45)] ring-1 ring-cyan-200/70'
                        : 'bg-white/[0.06] border-white/15 text-slate-100 hover:bg-cyan-400/15 hover:border-cyan-300/45'
                    }`}
                  >
                    {btn.label}
                  </Button>
                );
              })}
            </div>
          </div>
        </div>
      </GlassPanel>

      {scenarioError && (
        <GlassPanel tone="coral" padding="px-4 py-3">
          <div className="text-xs text-rose-200 flex items-center justify-between gap-3">
            <span>Scenario request failed: {scenarioError}</span>
            <button
              type="button"
              onClick={() => setScenarioError(null)}
              className="underline font-medium hover:text-white"
            >
              Dismiss
            </button>
          </div>
        </GlassPanel>
      )}

      {/* Ground-Truth Illuminated Status Strip */}
      <GlassPanel tone={hasActiveFault ? 'coral' : 'default'} padding="px-4 py-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs">
          <div className="flex flex-wrap items-center gap-2.5">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                hasActiveFault
                  ? 'bg-rose-400 shadow-[0_0_12px_rgba(244,63,94,0.85)]'
                  : 'bg-cyan-300/60'
              }`}
              aria-hidden="true"
            />
            <span className="font-mono text-[11px] uppercase tracking-wider text-slate-300">
              Injected (ground truth):
            </span>
            {hasActiveFault && activeFault ? (
              <span className="font-mono text-xs font-semibold text-white px-2.5 py-0.5 rounded-full bg-rose-500/20 border border-rose-300/45 tabular-nums">
                {activeFaultNode?.name ?? activeFault.node_id.slice(0, 8)},{' '}
                {formatSignedMs(injectedBadgeValue)}
              </span>
            ) : (
              <span className="font-mono text-xs text-slate-300/80">No active fault</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2.5 font-mono text-[11px] tabular-nums">
            <span className="px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-slate-200">
              {`${nodes.length} nodes`}
            </span>
            {network && (
              <>
                <span className="px-2 py-0.5 rounded-md bg-emerald-400/12 border border-emerald-300/30 text-emerald-200">
                  {`${network.trusted} trusted`}
                </span>
                {network.suspect > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-amber-400/12 border border-amber-300/30 text-amber-200">
                    {`${network.suspect} suspect`}
                  </span>
                )}
                {network.quarantined > 0 && (
                  <span className="px-2 py-0.5 rounded-md bg-rose-500/15 border border-rose-300/35 text-rose-200">
                    {`${network.quarantined} quarantined`}
                  </span>
                )}
              </>
            )}
          </div>
        </div>
      </GlassPanel>

      {/* Split Screen: Left Unverified Baseline (Coral Glass) vs Right Chronyx Verified (Cyan/Emerald Glass) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Left: Unverified Baseline */}
        <div data-testid="compare-left" className="h-full">
          <GlassPanel tone="coral" className="h-full">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-rose-300">
                    Unverified Baseline
                  </span>
                  <h3 className="text-base font-bold text-white flex items-center gap-1.5">
                    <span>{baseline?.label ?? 'Baseline unavailable'}</span>
                    <InfoTip text="A naive sync follower trusts its input clock without cluster cross-checks or anomaly alarms." />
                  </h3>
                  <p className="text-xs text-slate-300/85">
                    Unverified baseline (alarm is always false)
                  </p>
                </div>
                <span className="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-mono border bg-rose-500/18 text-rose-200 border-rose-300/40 shrink-0 shadow-[0_0_16px_rgba(244,63,94,0.18)]">
                  No alarm raised
                </span>
              </div>

              {/* Recessed Frosted KPI Well */}
              <div className="flex items-center justify-between px-4 py-3.5 rounded-xl bg-black/30 border border-rose-300/20 backdrop-blur-md">
                <div>
                  <span className="text-xs font-medium text-slate-200 flex items-center gap-1">
                    Cluster-time error
                    <InfoTip text="Mean timing error carried by the naive baseline across all nodes." />
                  </span>
                  <span className="text-[11px] text-rose-200/75 block mt-0.5">
                    Carried silently into downstream observations
                  </span>
                </div>
                <span className="font-mono text-2xl font-bold text-rose-300 tabular-nums">
                  {baseline ? formatSignedMs(baseline.cluster_time_error_ms) : '--'}
                </span>
              </div>

              {/* Per-node baseline error rows */}
              <div className="space-y-2">
                {baseline && baseline.per_node.length > 0 ? (
                  baseline.per_node.map((entry) => {
                    const nodeMeta = nodes.find((n) => n.id === entry.node_id);
                    const widthPct = Math.min(
                      100,
                      (Math.abs(entry.followed_error_ms) / maxBaselineBar) * 100,
                    );
                    return (
                      <div
                        key={entry.node_id}
                        className="p-2.5 rounded-xl bg-white/[0.04] border border-white/10 space-y-1.5"
                      >
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium text-white truncate">
                            {nodeMeta?.name ?? entry.node_id.slice(0, 8)}
                          </span>
                          <span className="font-mono text-rose-200 tabular-nums">
                            {formatSignedMs(entry.followed_error_ms)}
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                          <div
                            className="h-full bg-gradient-to-r from-rose-500 to-fuchsia-400 rounded-full transition-all duration-200"
                            style={{ width: `${widthPct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <p className="text-xs text-slate-300/80 py-3 text-center rounded-xl bg-white/[0.03] border border-white/10">
                    No baseline node readings available.
                  </p>
                )}
              </div>
            </div>
          </GlassPanel>
        </div>

        {/* Right: Chronyx Verified */}
        <div data-testid="compare-right" className="h-full">
          <GlassPanel tone="cyan" className="h-full">
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-0.5">
                  <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-cyan-300">
                    Chronyx Verification Layer
                  </span>
                  <h3 className="text-base font-bold text-cyan-200">Chronyx Verified</h3>
                  <p className="text-xs text-slate-300/85">
                    Cluster consensus, anomaly detection, and quarantine
                  </p>
                </div>
                <div className="px-3.5 py-1.5 rounded-xl bg-black/30 border border-cyan-300/35 text-right shrink-0 shadow-[0_0_18px_rgba(61,214,245,0.16)]">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-cyan-200/80">
                    Network Health
                  </div>
                  <div className="font-mono text-xl font-bold text-emerald-300 tabular-nums leading-tight">
                    {network ? `${network.score}%` : '--'}
                  </div>
                </div>
              </div>

              <div className="space-y-2">
                {sortedNodes.map((node) => {
                  const assessment = assessments[node.id];
                  const confPct = assessment ? Math.round(assessment.confidence * 100) : null;
                  return (
                    <div
                      key={node.id}
                      className="flex items-center justify-between gap-2 py-2.5 px-3 rounded-xl bg-white/[0.045] border border-white/12 hover:border-cyan-300/35 transition-colors text-xs"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-medium text-white truncate">{node.name}</span>
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded-md bg-white/[0.06] border border-white/12 text-slate-300 shrink-0">
                          {node.kind === 'virtual' ? 'Simulated' : 'Real'}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        {assessment ? (
                          <>
                            <StateChip state={assessment.state} size="sm" />
                            <div className="flex items-center gap-2">
                              <div className="hidden sm:block w-14 h-1.5 rounded-full bg-white/10 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-emerald-400"
                                  style={{ width: `${confPct ?? 0}%` }}
                                />
                              </div>
                              <span className="font-mono text-cyan-100 tabular-nums w-10 text-right">
                                {`${confPct}%`}
                              </span>
                            </div>
                          </>
                        ) : (
                          <span className="text-slate-300/75 font-mono">Unassessed</span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </GlassPanel>
        </div>
      </div>

      {/* Large Framed Liquid-Glass Timeline Instrument Panel */}
      <div data-testid="compare-chart">
        <GlassPanel tone="default">
          <div className="space-y-3.5">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
              <div>
                <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-indigo-300">
                  Synchronized Telemetry Stream
                </span>
                <h3 className="text-base font-bold text-white">
                  Shared Timing Error Timeline (ms)
                </h3>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 text-[11px] font-mono">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white/[0.05] border border-white/12 text-slate-200">
                  <span className="h-0.5 w-3.5 bg-slate-300 inline-block" aria-hidden="true" />
                  Injected (ground truth)
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/12 border border-rose-300/30 text-rose-200">
                  <span className="h-0.5 w-3.5 bg-rose-400 inline-block" aria-hidden="true" />
                  Baseline error
                </span>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-cyan-400/12 border border-cyan-300/35 text-cyan-200">
                  <span className="h-0.5 w-3.5 bg-cyan-300 inline-block" aria-hidden="true" />
                  Chronyx estimate
                </span>
                {quarantineMarkerLabel && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/20 border border-rose-300/50 text-rose-100 shadow-[0_0_16px_rgba(244,63,94,0.3)]">
                    {`Quarantine at ${quarantineMarkerLabel}`}
                  </span>
                )}
              </div>
            </div>

            <div className="rounded-xl bg-[#040814]/60 border border-white/12 p-3 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
              {chartPoints.length > 0 ? (
                <div className="h-72 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={chartPoints}
                      margin={{ top: 12, right: 18, left: 4, bottom: 2 }}
                    >
                      <CartesianGrid stroke="rgba(148,163,184,0.14)" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="label"
                        stroke="#94A3B8"
                        tick={{ fill: '#CBD5E1', fontSize: 11 }}
                        tickLine={{ stroke: 'rgba(148,163,184,0.25)' }}
                      />
                      <YAxis
                        stroke="#94A3B8"
                        tick={{ fill: '#CBD5E1', fontSize: 11 }}
                        tickLine={{ stroke: 'rgba(148,163,184,0.25)' }}
                        unit=" ms"
                      />
                      <ReferenceLine y={0} stroke="rgba(148,163,184,0.35)" strokeWidth={1} />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(9, 16, 34, 0.92)',
                          borderColor: 'rgba(125, 211, 252, 0.35)',
                          borderRadius: '12px',
                          fontSize: '12px',
                          color: '#F8FAFC',
                        }}
                      />
                      {quarantineMarkerLabel && (
                        <ReferenceLine
                          x={quarantineMarkerLabel}
                          stroke="#FB7185"
                          strokeWidth={2}
                          strokeDasharray="4 4"
                          label={{
                            value: 'Quarantined',
                            fill: '#FDA4AF',
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
                        strokeWidth={2}
                        strokeDasharray="4 3"
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="baseline_ms"
                        name={baseline?.label ?? 'Baseline'}
                        stroke="#FB7185"
                        strokeWidth={2.5}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                      <Line
                        type="monotone"
                        dataKey="chronyx_ms"
                        name="Chronyx estimate"
                        stroke="#3DD6F5"
                        strokeWidth={2.5}
                        dot={false}
                        isAnimationActive={false}
                        connectNulls
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="py-12 text-center text-xs text-slate-300/80 font-mono">
                  Waiting for live assessment ticks to plot the shared timeline.
                </div>
              )}
            </div>
          </div>
        </GlassPanel>
      </div>

      {/* Bottom Glass Evidence Summary Strip */}
      <div data-testid="metrics-strip">
        <GlassPanel tone="cyan" padding="p-4">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 flex-1">
              <div className="px-3.5 py-2.5 rounded-xl bg-black/30 border border-white/12">
                <div className="text-[11px] text-slate-300">Time to detect</div>
                <div className="mt-0.5 font-mono text-base font-bold text-cyan-200 tabular-nums">
                  {metricsLoading
                    ? 'Loading...'
                    : latestFaultMetric?.detection_latency_s !== null &&
                        latestFaultMetric?.detection_latency_s !== undefined
                      ? `${latestFaultMetric.detection_latency_s.toFixed(1)} s`
                      : '--'}
                </div>
              </div>
              <div className="px-3.5 py-2.5 rounded-xl bg-black/30 border border-white/12">
                <div className="text-[11px] text-slate-300">Error at detection</div>
                <div className="mt-0.5 font-mono text-base font-bold text-white tabular-nums">
                  {latestFaultMetric?.error_at_detect_ms !== null &&
                  latestFaultMetric?.error_at_detect_ms !== undefined
                    ? formatSignedMs(latestFaultMetric.error_at_detect_ms)
                    : '--'}
                </div>
              </div>
              <div className="px-3.5 py-2.5 rounded-xl bg-black/30 border border-rose-300/20">
                <div className="text-[11px] text-slate-300 flex items-center gap-1">
                  Baseline alarms
                  <InfoTip text="Naive clock followers do not raise timing-integrity alarms." />
                </div>
                <div className="mt-0.5 font-mono text-base font-bold text-rose-300 tabular-nums">
                  {liveMetrics
                    ? liveMetrics.faults.filter((f) => f.baseline_alarmed).length
                    : 0}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 shrink-0">
              {metricsError && (
                <button
                  type="button"
                  onClick={() => void fetchLiveMetrics()}
                  className="text-xs text-amber-200 underline hover:text-white"
                >
                  Metrics unavailable (retry)
                </button>
              )}
              <Link
                to="/science"
                className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-xs font-semibold bg-cyan-400/20 text-cyan-100 border border-cyan-300/50 hover:bg-cyan-400/30 hover:-translate-y-[1px] transition-all shadow-[0_0_20px_rgba(61,214,245,0.2)]"
              >
                See what this does to the science →
              </Link>
            </div>
          </div>
        </GlassPanel>
      </div>
    </LiquidGlassShell>
  );
}
