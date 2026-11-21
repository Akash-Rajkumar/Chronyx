import { useEffect } from 'react';
import {
  useDashboardStore,
  useNetworkHealth,
  useNodes,
  useAssessments,
  useRecentTransitions,
  useIsLoading,
  useStoreError,
  useConnectionStatus,
} from '../../state/useDashboardStore.js';
import { StateChip } from '../../ui/StateChip.js';
import { ConfidenceRing } from '../../ui/ConfidenceRing.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { initDashboardSocket } from '../../api/socket.js';
import { Link } from 'react-router-dom';

/**
 * Live Overview Page (Part G4.1)
 * Owned by Person 3 (P3-T1/T3)
 * Subscribes to central Zustand store for 1 Hz telemetry and mock feeds.
 * Implements strict data integrity for missing/unassessed values and honest cluster alerts.
 */
export function OverviewPage() {
  // Ensure dashboard feed / mock bootstrap is active
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const networkHook = useNetworkHealth();
  const nodesHook = useNodes();
  const assessmentsHook = useAssessments();
  const recentTransitionsHook = useRecentTransitions();
  const isLoadingHook = useIsLoading();
  const errorHook = useStoreError();
  const connectionStatusHook = useConnectionStatus();

  // In client (browser), use granular reactive selector hooks.
  // In SSR / Node test renderer, read current store state.
  const isClient = typeof window !== 'undefined';
  const storeState = isClient ? null : useDashboardStore.getState();

  const network = isClient ? networkHook : storeState!.network;
  const nodes = isClient ? nodesHook : storeState!.nodes;
  const assessments = isClient ? assessmentsHook : storeState!.assessments;
  const recentTransitions = isClient ? recentTransitionsHook : storeState!.recentTransitions;
  const isLoading = isClient ? isLoadingHook : storeState!.isLoading;
  const error = isClient ? errorHook : storeState!.error;
  const connectionStatus = isClient ? connectionStatusHook : storeState!.connectionStatus;

  const isMock = connectionStatus === 'mock';

  // Compute honest alert strip state
  const hasTransitions = recentTransitions.length > 0;
  const latestTransition = recentTransitions[0];

  let alertMessage: React.ReactNode;
  let alertStyle = 'chronyx-glass-subtle border-white/[0.1] text-muted';

  if (hasTransitions && latestTransition) {
    alertStyle =
      'chronyx-glass-subtle border-white/[0.12] border-l-2 border-l-trust-suspect text-amber-100';
    alertMessage = (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <strong className="font-semibold text-trust-suspect">State Transition:</strong> Node{' '}
          <span className="font-mono text-foreground">{latestTransition.node_id.slice(0, 8)}</span>{' '}
          transitioned from <span className="font-mono uppercase">{latestTransition.from}</span> to{' '}
          <span className="font-mono uppercase">{latestTransition.to}</span>
          {latestTransition.reasons.length > 0 && ` (${latestTransition.reasons.join(', ')})`}
        </span>
        <span className="font-mono text-[11px] text-amber-200/85 tabular-nums">
          offset: {latestTransition.error_est_ms.toFixed(2)} ms
        </span>
      </div>
    );
  } else if (network && network.n > 0) {
    const hasAnomalies = network.quarantined > 0 || network.suspect > 0;
    const allTrusted = network.trusted === network.n && !hasAnomalies;

    if (allTrusted) {
      alertStyle =
        'chronyx-glass-subtle border-white/[0.12] border-l-2 border-l-trust-trusted text-emerald-100';
      alertMessage = (
        <span>
          <strong className="font-semibold text-trust-trusted">Cluster Operational:</strong> All{' '}
          {network.n} nodes trusted and calibrated. Zero active anomalies.
        </span>
      );
    } else if (hasAnomalies) {
      alertStyle =
        'chronyx-glass-subtle border-rose-400/25 border-l-2 border-l-trust-quarantined text-rose-100';
      alertMessage = (
        <span>
          <strong className="font-semibold text-trust-quarantined">Cluster Anomaly Active:</strong>{' '}
          {network.quarantined} quarantined, {network.suspect} suspect out of {network.n} nodes.
        </span>
      );
    } else {
      alertStyle = 'chronyx-glass-subtle border-white/[0.12] text-foreground/85';
      alertMessage = (
        <span>
          Cluster active ({network.trusted}/{network.n} trusted, {network.recovering} recovering).
          No recent transitions.
        </span>
      );
    }
  } else {
    // Empty or unavailable network data: neutral message
    alertStyle = 'chronyx-glass-subtle border-white/[0.1] text-muted';
    alertMessage = <span>Observatory cluster standby. Telemetry status unavailable.</span>;
  }

  const onlineCount = nodes.filter((n) => n.online).length;
  const isLiveStream = !isMock && connectionStatus === 'connected';

  return (
    <div className="space-y-6">
      {/* Asymmetric Live Operations Header & Focal Network Health Instrument */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
        {/* Left (7 cols): Title, Honest Disclosure & Flat Hairline Alert Strip */}
        <div className="lg:col-span-7 flex flex-col justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-3">
              <h2 className="text-2xl font-semibold tracking-tight text-foreground">
                Observatory Overview
              </h2>
              {isMock && (
                <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded-[6px] bg-amber-500/12 border border-amber-400/30 text-amber-200">
                  SIMULATED (MOCK) — VITE_USE_MOCKS=1
                </span>
              )}
            </div>
            <p className="text-sm text-muted">
              Realtime timing verification across observatory nodes
            </p>
          </div>

          {/* Alert Strip: Transition or honest cluster state */}
          <div
            data-testid="alert-strip"
            className={`px-4 py-3 rounded-[10px] text-xs border transition-colors duration-[180ms] ease-out ${alertStyle}`}
          >
            {alertMessage}
          </div>
        </div>

        {/* Right (5 cols): Expressive Primary Network Health Instrument */}
        <div
          data-testid="network-health"
          className={`lg:col-span-5 chronyx-glass-elevated chronyx-corner-ticks rounded-[14px] p-5 flex flex-col justify-between gap-4 ${
            isLiveStream ? 'chronyx-live-surface' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <span>Network Health</span>
                {isLiveStream && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-trust-trusted chronyx-live-dot"
                    aria-hidden="true"
                  />
                )}
              </div>
              <div className="flex items-baseline gap-2.5">
                <span className="font-mono text-3xl font-semibold text-accent-cyan tabular-nums leading-none">
                  {network ? `${network.score}%` : '--'}
                </span>
                {network && (
                  <span className="text-xs font-mono text-muted tabular-nums">
                    ({network.trusted}/{network.n} trusted, f={network.fault_tolerance_f})
                  </span>
                )}
              </div>
            </div>

            <div className="text-right font-mono text-[11px] text-muted tabular-nums space-y-0.5">
              <div>{nodes.length > 0 ? `${onlineCount}/${nodes.length} online` : '0 nodes'}</div>
              {network && (
                <div className={network.anchor_ok ? 'text-trust-trusted' : 'text-trust-quarantined'}>
                  {network.anchor_ok ? 'Anchors synced' : 'Anchors unavailable'}
                </div>
              )}
            </div>
          </div>

          {/* Hairline-Divided Trust Breakdown (no nested card clutter) */}
          <div className="grid grid-cols-4 divide-x divide-white/[0.08] pt-3 border-t border-white/[0.08] font-mono tabular-nums">
            <div className="pr-3">
              <span className="text-[10px] text-muted block">Trusted</span>
              <span className="text-sm font-semibold text-trust-trusted">
                {network ? network.trusted : '--'}
              </span>
            </div>
            <div className="px-3">
              <span className="text-[10px] text-muted block">Suspect</span>
              <span className="text-sm font-semibold text-trust-suspect">
                {network ? network.suspect : '--'}
              </span>
            </div>
            <div className="px-3">
              <span className="text-[10px] text-muted block">Quarant.</span>
              <span className="text-sm font-semibold text-trust-quarantined">
                {network ? network.quarantined : '--'}
              </span>
            </div>
            <div className="pl-3">
              <span className="text-[10px] text-muted block">Recover.</span>
              <span className="text-sm font-semibold text-trust-recovering">
                {network ? network.recovering : '--'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Error State Banner */}
      {error && (
        <div className="px-4 py-3 bg-rose-500/[0.1] backdrop-blur-md border border-rose-400/25 border-l-2 border-l-trust-quarantined text-rose-100 rounded-[10px] text-xs">
          <strong className="font-semibold text-trust-quarantined">Stream Notice:</strong> {error}
        </div>
      )}

      {/* Instrument Section Divider for Nodes Grid */}
      {nodes.length > 0 && (
        <div className="flex items-center gap-4 pt-1">
          <h3 className="text-sm font-medium text-foreground shrink-0">Observatory Nodes</h3>
          <div className="h-px flex-1 bg-white/[0.07]" aria-hidden="true" />
          <span className="text-xs font-mono text-muted tabular-nums shrink-0">
            {onlineCount} online · {nodes.length} registered
          </span>
        </div>
      )}

      {/* Nodes Grid */}
      {isLoading && nodes.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          <Skeleton height={188} />
          <Skeleton height={188} />
          <Skeleton height={188} />
        </div>
      ) : nodes.length === 0 ? (
        <EmptyState
          title="No Observatory Nodes Connected"
          description="Waiting for nodes to join or telemetry feed to connect."
          action={
            <Link
              to="/join"
              className="inline-flex items-center px-3.5 py-2 rounded-[10px] text-xs font-medium bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/35 hover:bg-accent-cyan/22 transition-colors duration-[180ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
            >
              Connect a node now →
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {nodes.map((node) => {
            const assessment = assessments[node.id];
            const hasAssessment = Boolean(assessment);
            const hasConfidence =
              assessment?.confidence !== undefined && assessment?.confidence !== null;

            const anomalyBorderClass =
              assessment?.state === 'quarantined'
                ? 'border-trust-quarantined/45'
                : assessment?.state === 'suspect'
                  ? 'border-trust-suspect/40'
                  : '';

            return (
              <div
                key={node.id}
                data-testid="node-card"
                className={`chronyx-glass rounded-xl p-4 space-y-3.5 ${anomalyBorderClass}`}
              >
                {/* Band 1: Identity & Trust State */}
                <div className="flex justify-between items-start gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/nodes/${node.id}`}
                        className="font-semibold text-sm text-foreground hover:text-accent-cyan transition-colors duration-[160ms] ease-out truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 rounded"
                      >
                        {node.name}
                      </Link>
                      <span className="text-[11px] font-mono text-muted/80 shrink-0">
                        · {node.kind}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted/75 font-mono block mt-0.5">
                      {node.id.slice(0, 8)}...
                    </span>
                  </div>

                  {/* Trust State Chip: Never default missing to Trusted */}
                  {hasAssessment && assessment ? (
                    <StateChip state={assessment.state} size="sm" />
                  ) : (
                    <span
                      data-testid="state-chip"
                      className="inline-flex items-center rounded-[6px] font-mono text-[11px] px-2 py-0.5 border border-white/15 bg-white/[0.04] text-muted shrink-0"
                      title="Node awaiting first engine assessment"
                    >
                      Unassessed
                    </span>
                  )}
                </div>

                {/* Band 2: Confidence Ring & Aligned Offset / Uncertainty Column */}
                <div className="flex items-center justify-between gap-4 py-3 border-y border-white/[0.07]">
                  {/* Confidence Ring: Never default missing to 1 or 0% */}
                  {hasConfidence && assessment ? (
                    <ConfidenceRing
                      confidence={assessment.confidence}
                      size={50}
                      strokeWidth={3.5}
                      label="Confidence"
                    />
                  ) : (
                    <div
                      data-testid="confidence-ring"
                      className="inline-flex flex-col items-center justify-center gap-1"
                    >
                      <div className="h-12 w-12 rounded-full border border-dashed border-white/20 flex items-center justify-center">
                        <span className="font-mono text-xs text-muted">--</span>
                      </div>
                      <span className="text-[11px] text-muted text-center">Confidence</span>
                    </div>
                  )}

                  <div className="text-right space-y-2">
                    <div>
                      <span className="text-[11px] text-muted block">Clock Offset</span>
                      <span className="font-mono text-base font-semibold text-foreground tabular-nums">
                        {assessment
                          ? `${assessment.error_est_ms >= 0 ? '+' : ''}${assessment.error_est_ms.toFixed(2)} ms`
                          : '--'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[11px] text-muted block">Uncertainty (1σ)</span>
                      <span className="font-mono text-xs text-muted tabular-nums">
                        {assessment ? `±${assessment.sigma_ms.toFixed(2)} ms` : '--'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Band 3: Technical Residuals & Online Status */}
                <div className="flex items-center justify-between text-[11px] font-mono text-muted tabular-nums">
                  <div className="flex items-center gap-3">
                    <span>z: {assessment ? assessment.z.toFixed(2) : '--'}</span>
                    <span className="text-white/20">·</span>
                    <span>cusum: {assessment ? `${assessment.cusum.toFixed(2)}σ` : '--'}</span>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 ${
                      node.online ? 'text-trust-trusted' : 'text-muted'
                    }`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${
                        node.online
                          ? isLiveStream
                            ? 'bg-trust-trusted chronyx-live-dot'
                            : 'bg-trust-trusted'
                          : 'bg-muted/50'
                      }`}
                      aria-hidden="true"
                    />
                    {node.online ? 'Online' : 'Offline'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
