import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import type { JoinInfo } from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import {
  useAssessments,
  useConnectionStatus,
  useDashboardStore,
  useIsLoading,
  useNetworkHealth,
  useNodes,
  useRecentTransitions,
  useStoreError,
} from '../../state/useDashboardStore.js';
import { ConfidenceRing } from '../../ui/ConfidenceRing.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { Sparkline } from '../../ui/Sparkline.js';
import { StateChip } from '../../ui/StateChip.js';
import { QuorumConstellation } from './QuorumConstellation.js';

const MAX_SPARK_POINTS = 60;

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
  const isLiveStream = !isMock && connectionStatus === 'connected';

  // Client-only 60-sample offset ring per node from incoming live assessments (never fabricated)
  const [offsetHistory, setOffsetHistory] = useState<Record<string, number[]>>({});
  const lastSampleTsRef = useRef<Record<string, number>>({});

  useEffect(() => {
    const entries = Object.values(assessments);
    if (entries.length === 0) return;

    let changed = false;
    const updates: Record<string, number> = {};
    for (const a of entries) {
      if (lastSampleTsRef.current[a.node_id] !== a.t_ms) {
        lastSampleTsRef.current[a.node_id] = a.t_ms;
        updates[a.node_id] = a.error_est_ms;
        changed = true;
      }
    }
    if (!changed) return;

    setOffsetHistory((prev) => {
      const next = { ...prev };
      for (const [nodeId, val] of Object.entries(updates)) {
        const series = prev[nodeId] ?? [];
        next[nodeId] = [...series.slice(-(MAX_SPARK_POINTS - 1)), val];
      }
      return next;
    });
  }, [assessments]);

  const sortedNodes = useMemo(
    () => [...nodes].sort((a, b) => a.name.localeCompare(b.name)),
    [nodes],
  );

  const realNodesCount = useMemo(
    () => nodes.filter((n) => n.kind === 'browser').length,
    [nodes],
  );

  const [joinInfo, setJoinInfo] = useState<JoinInfo | null>(null);
  useEffect(() => {
    if (!isClient || realNodesCount > 0) return;
    let active = true;
    api
      .getJoinInfo()
      .then((info) => {
        if (active) setJoinInfo(info);
      })
      .catch(() => {
        // Fallback link to /join remains available without error noise
      });
    return () => {
      active = false;
    };
  }, [isClient, realNodesCount]);

  // Compute honest alert strip state
  const hasTransitions = recentTransitions.length > 0;
  const latestTransition = recentTransitions[0];

  let alertMessage: React.ReactNode;
  let alertStyle = 'mc-well border-white/[0.1] text-muted';

  if (hasTransitions && latestTransition) {
    alertStyle = 'mc-well border-white/[0.12] border-l-2 border-l-trust-suspect text-amber-100';
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
        'mc-well border-white/[0.12] border-l-2 border-l-trust-trusted text-emerald-100';
      alertMessage = (
        <span>
          <strong className="font-semibold text-trust-trusted">Cluster Operational:</strong> All{' '}
          {network.n} nodes trusted and calibrated. Zero active anomalies.
        </span>
      );
    } else if (hasAnomalies) {
      alertStyle =
        'mc-well border-rose-400/25 border-l-2 border-l-trust-quarantined text-rose-100';
      alertMessage = (
        <span>
          <strong className="font-semibold text-trust-quarantined">Cluster Anomaly Active:</strong>{' '}
          {network.quarantined} quarantined, {network.suspect} suspect out of {network.n} nodes.
        </span>
      );
    } else {
      alertStyle = 'mc-well border-white/[0.12] text-foreground/85';
      alertMessage = (
        <span>
          Cluster active ({network.trusted}/{network.n} trusted, {network.recovering} recovering).
          No recent transitions.
        </span>
      );
    }
  } else {
    alertStyle = 'mc-well border-white/[0.1] text-muted';
    alertMessage = <span>Observatory cluster standby. Telemetry status unavailable.</span>;
  }

  const onlineCount = nodes.filter((n) => n.online).length;
  const virtualCount = nodes.length - realNodesCount;
  const fallbackJoinUrl = isClient ? `${window.location.origin}/join` : '/join';
  const qrValue = joinInfo?.join_url ?? fallbackJoinUrl;

  return (
    <div className="space-y-6">
      {/* Band 1: Asymmetric Operations Header & Focal Network Health Instrument */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
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

          <div
            data-testid="alert-strip"
            className={`px-4 py-3 rounded-[10px] text-xs border transition-colors duration-[180ms] ease-out ${alertStyle}`}
          >
            {alertMessage}
          </div>
        </div>

        <div
          data-testid="network-health"
          className={`lg:col-span-5 mc-panel-primary mc-ticks rounded-[14px] p-5 flex flex-col justify-between gap-4 ${
            isLiveStream ? 'mc-live-surface' : ''
          }`}
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs font-medium text-muted">
                <span>Network Health</span>
                {isLiveStream && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-trust-trusted mc-live-dot"
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

      {/* Band 2: Centerpiece Live Quorum Constellation + Contextual Cluster Panel */}
      {nodes.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-stretch">
          <div className="lg:col-span-8 mc-panel-primary rounded-[14px] p-5 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-semibold text-foreground">
                  Timing Quorum Constellation
                </h3>
                <p className="text-xs text-muted">
                  Star-topology verification around the hub — click any node to inspect streams
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-muted">
                <span className="text-trust-trusted">● Trusted</span>
                <span className="text-trust-suspect">▲ Suspect</span>
                <span className="text-trust-quarantined">■ Quarantined</span>
              </div>
            </div>

            <QuorumConstellation
              nodes={nodes}
              assessments={assessments}
              network={network}
              isLiveStream={isLiveStream}
            />
          </div>

          <div className="lg:col-span-4 mc-panel rounded-[14px] p-5 flex flex-col justify-between gap-4">
            {realNodesCount === 0 ? (
              <>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-foreground">
                      Add a Real Browser Node
                    </h3>
                    <span className="text-[11px] font-mono text-muted">
                      {virtualCount} virtual
                    </span>
                  </div>
                  <p className="text-xs text-muted leading-relaxed">
                    Virtual nodes simulate GNSS and camera-trigger streams in software. Scan or
                    open Join to add a real browser clock over this network.
                  </p>
                </div>

                {isClient && (
                  <div className="flex items-center gap-4 py-3 border-y border-white/[0.08]">
                    <div className="p-2 rounded-lg bg-white shrink-0">
                      <QRCodeSVG value={qrValue} size={76} bgColor="#FFFFFF" fgColor="#060B16" />
                    </div>
                    <div className="min-w-0 space-y-1">
                      <span className="text-[11px] font-mono text-muted block">Join URL</span>
                      <span className="text-xs font-mono text-foreground break-all block">
                        {qrValue}
                      </span>
                    </div>
                  </div>
                )}

                <Link
                  to="/join"
                  className="inline-flex items-center justify-center px-3.5 py-2.5 rounded-[10px] text-xs font-semibold bg-accent-cyan/[0.16] text-accent-cyan border border-accent-cyan/40 hover:bg-accent-cyan/[0.24] transition-colors duration-[180ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
                >
                  Open Join as a Node →
                </Link>
              </>
            ) : (
              <>
                <div className="space-y-1.5">
                  <h3 className="text-sm font-semibold text-foreground">Cluster Composition</h3>
                  <p className="text-xs text-muted">
                    Quorum tolerates f faulty nodes when n ≥ 3f + 1 under independent faults.
                  </p>
                </div>

                <div className="mc-well rounded-[10px] divide-y divide-white/[0.06] text-xs font-mono">
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-muted">Real browser nodes</span>
                    <span className="text-foreground font-semibold tabular-nums">
                      {realNodesCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-muted">Simulated virtual nodes</span>
                    <span className="text-foreground font-semibold tabular-nums">
                      {virtualCount}
                    </span>
                  </div>
                  <div className="flex items-center justify-between px-3 py-2.5">
                    <span className="text-muted">Fault tolerance (f)</span>
                    <span className="text-accent-cyan font-semibold tabular-nums">
                      {network ? network.fault_tolerance_f : '--'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 pt-1">
                  <Link
                    to="/compare"
                    className="flex-1 text-center px-3 py-2 rounded-[10px] text-xs font-medium bg-white/[0.06] border border-white/[0.13] text-foreground hover:border-accent-cyan/45 transition-colors duration-[180ms] ease-out"
                  >
                    Before vs After
                  </Link>
                  <Link
                    to="/redteam"
                    className="flex-1 text-center px-3 py-2 rounded-[10px] text-xs font-medium bg-trust-quarantined/[0.12] border border-trust-quarantined/35 text-trust-quarantined hover:bg-trust-quarantined/[0.2] transition-colors duration-[180ms] ease-out"
                  >
                    Red-Team
                  </Link>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Section Divider for Node Telemetry Cards */}
      {nodes.length > 0 && (
        <div className="flex items-center gap-4 pt-1">
          <h3 className="text-sm font-medium text-foreground shrink-0">Observatory Nodes</h3>
          <div className="h-px flex-1 bg-white/[0.07]" aria-hidden="true" />
          <span className="text-xs font-mono text-muted tabular-nums shrink-0">
            {onlineCount} online · {nodes.length} registered
          </span>
        </div>
      )}

      {/* Band 3: Deterministic Node Telemetry Cards */}
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
          {sortedNodes.map((node) => {
            const assessment = assessments[node.id];
            const hasAssessment = Boolean(assessment);
            const hasConfidence =
              assessment?.confidence !== undefined && assessment?.confidence !== null;
            const sparkData = offsetHistory[node.id] ?? [];

            const anomalyBorderClass =
              assessment?.state === 'quarantined'
                ? 'border-trust-quarantined/45'
                : assessment?.state === 'suspect'
                  ? 'border-trust-suspect/40'
                  : '';

            const sparkStroke =
              assessment?.state === 'quarantined'
                ? '#FF5C5C'
                : assessment?.state === 'suspect'
                  ? '#F5A524'
                  : '#3DD6F5';

            return (
              <div
                key={node.id}
                data-testid="node-card"
                className={`mc-panel rounded-[12px] p-4 space-y-3.5 ${anomalyBorderClass}`}
              >
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
                        · {node.kind === 'virtual' ? 'Simulated' : 'Real'}
                      </span>
                    </div>
                    <span className="text-[11px] text-muted/75 font-mono block mt-0.5">
                      {node.id.slice(0, 8)}...
                    </span>
                  </div>

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

                <div className="flex items-center justify-between gap-4 py-3 border-y border-white/[0.07]">
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

                <div className="flex items-center justify-between gap-3">
                  <Sparkline
                    data={sparkData}
                    width={110}
                    height={24}
                    strokeColor={sparkStroke}
                    fillColor="rgba(61, 214, 245, 0.08)"
                  />

                  <div className="flex items-center gap-2.5 text-[11px] font-mono text-muted tabular-nums">
                    <span>z: {assessment ? assessment.z.toFixed(2) : '--'}</span>
                    <span className="text-white/20">·</span>
                    <span>cusum: {assessment ? `${assessment.cusum.toFixed(2)}σ` : '--'}</span>
                    <span className="text-white/20">·</span>
                    <span
                      className={`inline-flex items-center gap-1 ${
                        node.online ? 'text-trust-trusted' : 'text-muted'
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          node.online
                            ? isLiveStream
                              ? 'bg-trust-trusted mc-live-dot'
                              : 'bg-trust-trusted'
                            : 'bg-muted/50'
                        }`}
                        aria-hidden="true"
                      />
                      {node.online ? 'Online' : 'Offline'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
