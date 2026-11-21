import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { HistoryPoint } from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import {
  useAssessment,
  useConnectionStatus,
  useNode,
} from '../../state/useDashboardStore.js';
import { Button } from '../../ui/Button.js';
import { ConfidenceRing } from '../../ui/ConfidenceRing.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Sparkline } from '../../ui/Sparkline.js';
import { StateChip } from '../../ui/StateChip.js';

/**
 * Node Detail Page (Part G4.2)
 * Owned by Person 3 (P3-T4)
 */
export function NodeDetailPage() {
  const { id } = useParams<{ id: string }>();

  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const node = useNode(id);
  const assessment = useAssessment(id);
  const connectionStatus = useConnectionStatus();

  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [loadingHistory, setLoadingHistory] = useState<boolean>(false);

  const fetchHistory = useCallback(async () => {
    if (!id) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const res = await api.getNodeHistory(id, 300);
      setHistory(res.points);
    } catch (err) {
      setHistoryError(err instanceof Error ? err.message : 'History unavailable');
    } finally {
      setLoadingHistory(false);
    }
  }, [id]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted mb-1">
            <Link to="/" className="text-accent-cyan hover:underline">
              ← Overview
            </Link>
            <span>·</span>
            <span className="font-mono">{id ?? '--'}</span>
          </div>
          <div className="flex items-center gap-3">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {node?.name ?? 'Node Detail'}
            </h2>
            {node && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-[6px] bg-white/[0.06] border border-white/[0.1] text-muted">
                {node.kind === 'virtual' ? 'Simulated' : 'Real'}
              </span>
            )}
            {connectionStatus === 'mock' && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-[6px] bg-amber-500/12 border border-amber-400/30 text-amber-200">
                SIMULATED (MOCK)
              </span>
            )}
          </div>
        </div>

        <Button variant="secondary" size="sm" onClick={() => void fetchHistory()}>
          Refresh History
        </Button>
      </div>

      {!node && !assessment ? (
        <EmptyState
          title="Node telemetry not found"
          description="This node may not be registered or the dashboard snapshot is still loading."
          action={
            <Link
              to="/"
              className="inline-flex items-center px-3.5 py-2 rounded-[10px] text-xs font-medium bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/35"
            >
              Return to Overview
            </Link>
          }
        />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          {/* Primary Assessment Summary */}
          <div className="lg:col-span-5 mc-panel-primary mc-ticks rounded-[14px] p-5 space-y-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted">Current Assessment</span>
              {assessment ? (
                <StateChip state={assessment.state} size="md" />
              ) : (
                <span
                  data-testid="state-chip"
                  className="font-mono text-xs px-2 py-0.5 rounded-[6px] border border-white/15 text-muted"
                >
                  Unassessed
                </span>
              )}
            </div>

            <div className="flex items-center justify-between py-4 border-y border-white/[0.08]">
              {assessment?.confidence !== undefined ? (
                <ConfidenceRing confidence={assessment.confidence} size={64} label="Confidence" />
              ) : (
                <div className="text-xs font-mono text-muted">--</div>
              )}

              <div className="text-right space-y-2 font-mono tabular-nums">
                <div>
                  <span className="text-[11px] text-muted block font-sans">Clock Offset</span>
                  <span className="text-xl font-semibold text-foreground">
                    {assessment
                      ? `${assessment.error_est_ms >= 0 ? '+' : ''}${assessment.error_est_ms.toFixed(2)} ms`
                      : '--'}
                  </span>
                </div>
                <div>
                  <span className="text-[11px] text-muted block font-sans">Uncertainty (1σ)</span>
                  <span className="text-xs text-muted">
                    {assessment ? `±${assessment.sigma_ms.toFixed(2)} ms` : '--'}
                  </span>
                </div>
              </div>
            </div>

            <div className="mc-well rounded-[10px] divide-y divide-white/[0.06] text-xs font-mono">
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted font-sans">Robust z-score</span>
                <span className="text-foreground">{assessment ? assessment.z.toFixed(2) : '--'}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted font-sans">CUSUM statistic</span>
                <span className="text-foreground">
                  {assessment ? `${assessment.cusum.toFixed(2)}σ` : '--'}
                </span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted font-sans">Suspected cause</span>
                <span className="text-foreground">{assessment?.suspected_cause ?? '--'}</span>
              </div>
              <div className="flex justify-between px-3 py-2">
                <span className="text-muted font-sans">Connection</span>
                <span className={node?.online ? 'text-trust-trusted' : 'text-muted'}>
                  {node?.online ? 'Online' : 'Offline'}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Stream Residuals & History */}
          <div className="lg:col-span-7 space-y-5">
            <div className="mc-panel rounded-[14px] p-5 space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Verification Streams</h3>
                <span className="text-xs font-mono text-muted">
                  {assessment?.streams.length ?? 0} active streams
                </span>
              </div>

              {assessment && assessment.streams.length > 0 ? (
                <div className="mc-well rounded-[10px] divide-y divide-white/[0.06] text-xs">
                  {assessment.streams.map((s) => (
                    <div key={s.stream} className="flex items-center justify-between px-3.5 py-2.5">
                      <div className="flex items-center gap-2.5">
                        <span className="font-mono font-medium text-foreground">{s.stream}</span>
                        {s.flagged && (
                          <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-trust-quarantined/15 border border-trust-quarantined/35 text-trust-quarantined">
                            FLAGGED
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-5 font-mono tabular-nums">
                        <span className="text-muted">
                          resid: <strong className="text-foreground">{s.residual_ms.toFixed(2)} ms</strong>
                        </span>
                        <span className="text-muted">
                          z: <strong className="text-foreground">{s.z.toFixed(2)}</strong>
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted">No individual stream readings reported yet.</p>
              )}
            </div>

            <div className="mc-panel rounded-[14px] p-5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">5-Minute Offset History</h3>
                <span className="text-xs font-mono text-muted">
                  {loadingHistory ? 'Loading...' : `${history.length} samples`}
                </span>
              </div>

              {historyError ? (
                <div className="text-xs text-muted flex items-center justify-between mc-well rounded-[10px] px-3.5 py-3">
                  <span>{historyError}</span>
                  <button
                    type="button"
                    onClick={() => void fetchHistory()}
                    className="text-accent-cyan underline"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="mc-well rounded-[10px] p-4 flex items-center justify-between gap-4">
                  <Sparkline
                    data={history.map((p) => p.error_est_ms)}
                    width={360}
                    height={56}
                    strokeColor="#3DD6F5"
                  />
                  <span className="text-xs font-mono text-muted shrink-0">
                    {history.length > 0
                      ? `Latest: ${history[history.length - 1]!.error_est_ms.toFixed(2)} ms`
                      : 'Awaiting samples'}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
