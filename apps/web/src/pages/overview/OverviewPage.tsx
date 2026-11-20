import { useEffect } from 'react';
import {
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
 */
export function OverviewPage() {
  // Ensure dashboard feed / mock bootstrap is active
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const network = useNetworkHealth();
  const nodes = useNodes();
  const assessments = useAssessments();
  const recentTransitions = useRecentTransitions();
  const isLoading = useIsLoading();
  const error = useStoreError();
  const connectionStatus = useConnectionStatus();

  const isMock = connectionStatus === 'mock';

  return (
    <div className="space-y-6">
      {/* Header & Network Health Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold tracking-tight text-foreground">Observatory Overview</h2>
            {isMock && (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-accent-cyan/10 border border-accent-cyan/30 text-accent-cyan">
                SIMULATED (MOCK)
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

      {/* Alert Strip: Latest state transition or operational calm */}
      {(() => {
        const latest = recentTransitions[0];
        return (
          <div
            data-testid="alert-strip"
            className={`p-3 rounded-lg text-xs border transition-colors ${
              latest
                ? 'bg-trust-suspect/10 border-trust-suspect/30 text-trust-suspect'
                : 'bg-card/50 border-border/60 text-muted'
            }`}
          >
            {latest ? (
              <div className="flex items-center justify-between">
                <span>
                  <strong>State Transition:</strong> Node {latest.node_id.slice(0, 8)} transitioned from{' '}
                  <span className="font-mono uppercase">{latest.from}</span> to{' '}
                  <span className="font-mono uppercase">{latest.to}</span>
                  {latest.reasons.length > 0 && ` (${latest.reasons.join(', ')})`}
                </span>
                <span className="font-mono text-[11px] opacity-75">
                  offset: {latest.error_est_ms.toFixed(2)} ms
                </span>
              </div>
            ) : (
              <span>No recent transitions. All nodes operational.</span>
            )}
          </div>
        );
      })()}

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
            const trustState = assessment?.state || 'trusted';
            const confidence = assessment?.confidence ?? 1;

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

                  <StateChip state={trustState} size="sm" />
                </div>

                {/* Primary Metrics: Confidence Ring & Error Offset */}
                <div className="flex items-center justify-between pt-1 border-t border-border/40">
                  <ConfidenceRing
                    confidence={confidence}
                    size={48}
                    strokeWidth={3.5}
                    label="Confidence"
                  />

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
                {assessment && (
                  <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] font-mono text-muted">
                    <span>z: {assessment.z.toFixed(2)}</span>
                    <span>cusum: {assessment.cusum.toFixed(2)}σ</span>
                    <span className={node.online ? 'text-trust-trusted' : 'text-muted'}>
                      {node.online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
