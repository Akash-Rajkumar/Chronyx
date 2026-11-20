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
  let alertStyle = 'bg-card/50 border-border/60 text-muted';

  if (hasTransitions && latestTransition) {
    alertStyle = 'bg-trust-suspect/10 border-trust-suspect/30 text-trust-suspect';
    alertMessage = (
      <div className="flex items-center justify-between">
        <span>
          <strong>State Transition:</strong> Node {latestTransition.node_id.slice(0, 8)} transitioned from{' '}
          <span className="font-mono uppercase">{latestTransition.from}</span> to{' '}
          <span className="font-mono uppercase">{latestTransition.to}</span>
          {latestTransition.reasons.length > 0 && ` (${latestTransition.reasons.join(', ')})`}
        </span>
        <span className="font-mono text-[11px] opacity-75">
          offset: {latestTransition.error_est_ms.toFixed(2)} ms
        </span>
      </div>
    );
  } else if (network && network.n > 0) {
    const hasAnomalies = network.quarantined > 0 || network.suspect > 0;
    const allTrusted = network.trusted === network.n && !hasAnomalies;

    if (allTrusted) {
      alertStyle = 'bg-trust-trusted/10 border-trust-trusted/30 text-trust-trusted';
      alertMessage = (
        <span>
          <strong>Cluster Operational:</strong> All {network.n} nodes trusted and calibrated. Zero active anomalies.
        </span>
      );
    } else if (hasAnomalies) {
      alertStyle = 'bg-trust-quarantined/10 border-trust-quarantined/30 text-trust-quarantined';
      alertMessage = (
        <span>
          <strong>Cluster Anomaly Active:</strong> {network.quarantined} quarantined, {network.suspect} suspect out of {network.n} nodes.
        </span>
      );
    } else {
      alertStyle = 'bg-card/50 border-border/60 text-muted';
      alertMessage = (
        <span>
          Cluster active ({network.trusted}/{network.n} trusted, {network.recovering} recovering). No recent transitions.
        </span>
      );
    }
  } else {
    // Empty or unavailable network data: neutral message
    alertStyle = 'bg-card/50 border-border/60 text-muted';
    alertMessage = <span>Observatory cluster standby. Telemetry status unavailable.</span>;
  }

  return (
    <div className="space-y-6">
      {/* Header & Network Health Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Observatory Overview</h2>
            {isMock && (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan">
                SIMULATED (MOCK) — VITE_USE_MOCKS=1
              </span>
            )}
          </div>
          <p className="text-sm text-muted">Realtime timing verification across observatory nodes</p>
        </div>

        <div
          data-testid="network-health"
          className="flex items-center gap-4 bg-card border border-border px-4 py-2.5 rounded-xl shrink-0"
        >
          <div className="flex flex-col">
            <span className="text-xs text-muted">Network Health</span>
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-xl font-bold text-accent-cyan tabular-nums">
                {network ? `${network.score}%` : '--'}
              </span>
              {network && (
                <span className="text-[11px] font-mono text-muted">
                  ({network.trusted}/{network.n} trusted, f={network.fault_tolerance_f})
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Alert Strip: Transition or honest cluster state */}
      <div
        data-testid="alert-strip"
        className={`p-3 rounded-lg text-xs border transition-colors ${alertStyle}`}
      >
        {alertMessage}
      </div>

      {/* Error State Banner */}
      {error && (
        <div className="p-4 bg-trust-quarantined/10 border border-trust-quarantined/30 text-trust-quarantined rounded-xl text-xs">
          <strong>Stream Notice:</strong> {error}
        </div>
      )}

      {/* Nodes Grid */}
      {isLoading && nodes.length === 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <Skeleton height={180} />
          <Skeleton height={180} />
          <Skeleton height={180} />
        </div>
      ) : nodes.length === 0 ? (
        <EmptyState
          title="No Observatory Nodes Connected"
          description="Waiting for nodes to join or telemetry feed to connect."
          action={
            <Link
              to="/join"
              className="text-xs font-semibold text-accent-cyan hover:underline"
            >
              Connect a node now →
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {nodes.map((node) => {
            const assessment = assessments[node.id];
            const hasAssessment = Boolean(assessment);
            const hasConfidence = assessment?.confidence !== undefined && assessment?.confidence !== null;

            return (
              <div
                key={node.id}
                data-testid="node-card"
                className="bg-card border border-border p-4 rounded-xl space-y-3 hover:border-accent-cyan/30 transition-colors"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2">
                      <Link
                        to={`/nodes/${node.id}`}
                        className="font-semibold text-sm hover:text-accent-cyan transition-colors"
                      >
                        {node.name}
                      </Link>
                      <span className="text-[10px] font-mono uppercase px-1.5 py-0.2 rounded bg-muted/10 text-muted">
                        {node.kind}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted font-mono block mt-0.5">
                      {node.id.slice(0, 8)}...
                    </span>
                  </div>

                  {/* Trust State Chip: Never default missing to Trusted */}
                  {hasAssessment && assessment ? (
                    <StateChip state={assessment.state} size="sm" />
                  ) : (
                    <span
                      data-testid="state-chip"
                      className="inline-flex items-center rounded-md font-mono text-[11px] px-2 py-0.5 border border-muted/30 bg-muted/10 text-muted"
                      title="Node awaiting first engine assessment"
                    >
                      Unassessed
                    </span>
                  )}
                </div>

                {/* Primary Metrics: Confidence Ring & Error Offset */}
                <div className="flex items-center justify-between pt-1 border-t border-border/40">
                  {/* Confidence Ring: Never default missing to 1 or 0% */}
                  {hasConfidence && assessment ? (
                    <ConfidenceRing
                      confidence={assessment.confidence}
                      size={48}
                      strokeWidth={3.5}
                      label="Confidence"
                    />
                  ) : (
                    <div
                      data-testid="confidence-ring"
                      className="inline-flex flex-col items-center justify-center gap-1"
                    >
                      <div className="h-12 w-12 rounded-full border border-dashed border-border/80 flex items-center justify-center">
                        <span className="font-mono text-xs text-muted">--</span>
                      </div>
                      <span className="text-[11px] text-muted text-center">Confidence</span>
                    </div>
                  )}

                  <div className="text-right space-y-1">
                    <div>
                      <span className="text-[10px] text-muted block">Clock Offset</span>
                      <span className="font-mono text-sm font-bold text-foreground tabular-nums">
                        {assessment
                          ? `${assessment.error_est_ms >= 0 ? '+' : ''}${assessment.error_est_ms.toFixed(2)} ms`
                          : '--'}
                      </span>
                    </div>
                    <div>
                      <span className="text-[10px] text-muted block">Uncertainty (1σ)</span>
                      <span className="font-mono text-xs text-muted tabular-nums">
                        {assessment ? `±${assessment.sigma_ms.toFixed(2)} ms` : '--'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Residual and Z-score summary */}
                <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] font-mono text-muted">
                  <span>z: {assessment ? assessment.z.toFixed(2) : '--'}</span>
                  <span>cusum: {assessment ? `${assessment.cusum.toFixed(2)}σ` : '--'}</span>
                  <span className={node.online ? 'text-trust-trusted' : 'text-muted'}>
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
