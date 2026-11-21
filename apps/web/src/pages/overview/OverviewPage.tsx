import React, { useEffect, useMemo } from 'react';
import { Link } from 'react-router-dom';
import type { NodeInfo, Assessment } from '@chronyx/contracts';
import {
  useDashboardStore,
  useNetworkHealth,
  useNodes,
  useAssessments,
  useRecentTransitions,
  useAnchors,
  useIsLoading,
  useStoreError,
  useConnectionStatus,
} from '../../state/useDashboardStore.js';
import { openQrModal } from '../../state/useQrModalStore.js';
import { StateChip } from '../../ui/StateChip.js';
import { ConfidenceRing } from '../../ui/ConfidenceRing.js';
import { Sparkline } from '../../ui/Sparkline.js';
import { Skeleton } from '../../ui/Skeleton.js';
import { EmptyState } from '../../ui/EmptyState.js';
import { InfoTip } from '../../ui/InfoTip.js';
import { initDashboardSocket } from '../../api/socket.js';

export function formatSignedOffset(ms: number | undefined | null): string {
  if (ms === undefined || ms === null || isNaN(ms)) return '--';
  const sign = ms >= 0 ? '+' : '';
  return `${sign}${ms.toFixed(2)} ms`;
}

export function formatTransitionReason(reasons: string[] | undefined): string {
  if (!reasons || reasons.length === 0) return 'Scheduled health assessment';
  const reason = reasons[0];
  switch (reason) {
    case 'OSC_STEP':
      return 'Clock jump detected (>10 ms step)';
    case 'CUSUM_DRIFT':
      return 'Clock drift exceeded confidence threshold';
    case 'GNSS_DISAGREE':
      return 'GNSS spoofing detected across cross-validation';
    case 'CAMERA_DISAGREE':
      return 'Optical occultation cross-check disagreement';
    case 'ANCHOR_DISAGREE':
      return 'UTC reference anchor disagreement';
    case 'PEER_OUTLIER':
      return 'Peer consensus outlier';
    case 'HEARTBEAT_GAP':
      return 'Heartbeat packet gap detected';
    case 'BAD_SIGNATURE':
      return 'Invalid cryptographic signature';
    case 'CHAIN_BREAK':
      return 'Broken cryptographic hash chain';
    case 'RECOVERY_BAND_OK':
      return 'Drift returned to verified recovery envelope (<5 ms)';
    case 'NODE_OFFLINE':
      return 'Node went offline';
    default:
      return reasons.join(', ');
  }
}

export function formatRelativeTime(timestampMs: number | string | undefined | null): string {
  if (!timestampMs) return 'Recently';
  const ms = typeof timestampMs === 'string' ? new Date(timestampMs).getTime() : timestampMs;
  if (isNaN(ms) || ms <= 0) return 'Recently';
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 5) return 'Just now';
  if (diffSec < 60) return `${diffSec}s ago`;
  const mins = Math.floor(diffSec / 60);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  return `${hours}h ago`;
}

interface NodeCardProps {
  node: NodeInfo;
  assessment?: Assessment;
  history: number[];
}

const NodeCard = React.memo(function NodeCard({ node, assessment, history }: NodeCardProps) {
  const isReal = node.kind === 'browser';
  const hasAssessment = Boolean(assessment);
  const hasConfidence = assessment?.confidence !== undefined && assessment?.confidence !== null;

  return (
    <Link
      to={`/nodes/${node.id}`}
      data-testid="node-card"
      aria-label={`Node ${node.name}, ${node.kind}, status ${assessment?.state ?? 'unassessed'}`}
      className="group block bg-card border border-border p-4 rounded-xl space-y-3.5 hover:border-accent-cyan/40 hover:shadow-lg transition-all focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
    >
      {/* Header: Name, Kind badge, Trust State */}
      <div className="flex justify-between items-start gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-sm text-foreground group-hover:text-accent-cyan transition-colors truncate">
              {node.name}
            </span>
            <span
              data-testid="node-kind-badge"
              className={`text-[10px] font-mono uppercase font-semibold px-2 py-0.5 rounded border shrink-0 ${
                isReal
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/30'
              }`}
            >
              {isReal ? 'Real' : 'Virtual'}
            </span>
          </div>
          <span className="text-[11px] text-muted font-mono block mt-0.5 truncate" title={node.id}>
            {node.id.slice(0, 8)}...
          </span>
        </div>

        {/* State Chip: Never default missing to Trusted */}
        <div className="shrink-0">
          {hasAssessment && assessment ? (
            <StateChip state={assessment.state} size="sm" showSymbol={true} showLabel={true} />
          ) : (
            <span
              data-testid="state-chip"
              className="inline-flex items-center gap-1 rounded-md font-mono text-[11px] px-2 py-0.5 border border-muted/30 bg-muted/10 text-muted"
              title="Node awaiting first engine assessment"
            >
              <span className="font-bold">■</span>
              <span>Unassessed</span>
            </span>
          )}
        </div>
      </div>

      {/* Metrics Row: Confidence Ring, Signed Offset, Sparkline */}
      <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/40 items-center">
        {/* Confidence Ring */}
        <div className="flex items-center gap-3">
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
              <span className="text-[10px] text-muted text-center font-medium">Confidence</span>
            </div>
          )}

          <div className="space-y-0.5">
            <span className="text-[10px] text-muted font-medium block">Offset</span>
            <span
              data-testid="signed-offset"
              className="font-mono text-sm font-bold text-foreground tabular-nums block"
            >
              {formatSignedOffset(assessment?.error_est_ms)}
            </span>
            <span className="text-[10px] font-mono text-muted/80 block tabular-nums">
              {assessment ? `±${assessment.sigma_ms.toFixed(2)} ms` : '--'}
            </span>
          </div>
        </div>

        {/* 60s Sparkline or honest calibrating state */}
        <div className="flex flex-col items-end justify-center space-y-1">
          <span className="text-[10px] text-muted font-medium">60s Trend</span>
          {history && history.length >= 2 ? (
            <div data-testid="sparkline-container" className="pt-0.5">
              <Sparkline
                data={history}
                width={100}
                height={26}
                strokeColor={
                  assessment?.state === 'quarantined'
                    ? '#FF5C5C'
                    : assessment?.state === 'suspect'
                    ? '#F5A524'
                    : '#3DD6F5'
                }
                fillColor="rgba(61, 214, 245, 0.08)"
              />
            </div>
          ) : (
            <div
              data-testid="sparkline-empty"
              className="h-[26px] flex items-center text-[10px] font-mono text-muted/60 italic"
            >
              Calibrating...
            </div>
          )}
        </div>
      </div>

      {/* Footer: Z-score & Last Seen */}
      <div className="pt-2 border-t border-border/40 flex items-center justify-between text-[11px] font-mono text-muted">
        <span>
          {assessment?.z !== undefined ? `z: ${assessment.z.toFixed(2)}` : 'z: --'}
        </span>
        <span className="truncate">
          {node.online ? (
            <span className="text-trust-trusted flex items-center gap-1">
              <span className="h-1.5 w-1.5 rounded-full bg-trust-trusted" />
              Active
            </span>
          ) : (
            <span>{formatRelativeTime(node.last_seen_at)}</span>
          )}
        </span>
      </div>
    </Link>
  );
});

/**
 * Live Overview Page (Part G4.1)
 * Displays network summary, node cards, honest transitions, primary actions, and no-real-nodes QR hint.
 */
export function OverviewPage() {
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const networkHook = useNetworkHealth();
  const nodesHook = useNodes();
  const assessmentsHook = useAssessments();
  const recentTransitionsHook = useRecentTransitions();
  const anchorsHook = useAnchors();
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
  const anchors = isClient ? anchorsHook : storeState!.anchors;
  const isLoading = isClient ? isLoadingHook : storeState!.isLoading;
  const error = isClient ? errorHook : storeState!.error;
  const connectionStatus = isClient ? connectionStatusHook : storeState!.connectionStatus;
  const assessmentHistory = isClient
    ? useDashboardStore((s) => s.assessmentHistory)
    : storeState!.assessmentHistory;

  const isMock = connectionStatus === 'mock';
  const isConnecting = connectionStatus === 'connecting';
  const isDisconnected = connectionStatus === 'disconnected';

  // Sort nodes alphabetically by name
  const sortedNodes = useMemo(() => {
    return [...nodes].sort((a, b) => a.name.localeCompare(b.name));
  }, [nodes]);

  // Check if any real browser nodes exist
  const hasRealNodes = useMemo(() => {
    return nodes.some((n) => n.kind === 'browser');
  }, [nodes]);

  // Authoritative anchor status calculation:
  // 1. Authoritative source is network.anchor_ok from verified snapshot / assessment stream.
  // 2. If network health is not yet loaded but individual anchor telemetry is available, check all anchors.
  // 3. Otherwise (awaiting snapshot, no anchor telemetry, or server indicates false), anchors are unavailable.
  const anchorsOk = useMemo(() => {
    if (network && typeof network.anchor_ok === 'boolean') {
      return network.anchor_ok;
    }
    if (anchors && anchors.length > 0) {
      return anchors.every((a) => a.ok);
    }
    return false;
  }, [network, anchors]);

  // Five most recent transitions
  const displayedTransitions = useMemo(() => {
    return recentTransitions.slice(0, 5);
  }, [recentTransitions]);

  // Node name lookup map for transitions
  const nodeMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const n of nodes) {
      map.set(n.id, n.name);
    }
    return map;
  }, [nodes]);

  return (
    <div className={`space-y-6 ${isConnecting ? 'opacity-85 transition-opacity' : ''}`}>
      {/* Reconnecting / Disconnected Banners */}
      {isConnecting && (
        <div
          data-testid="reconnecting-notice"
          className="p-3 rounded-xl bg-trust-suspect/10 border border-trust-suspect/30 text-trust-suspect text-xs flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-trust-suspect animate-ping" />
            <span>Reconnecting to Chronyx Gateway... Displaying last verified telemetry.</span>
          </div>
          <span className="font-mono text-[11px]">Syncing</span>
        </div>
      )}

      {isDisconnected && !isConnecting && (
        <div
          data-testid="disconnected-notice"
          className="p-3 rounded-xl bg-trust-quarantined/10 border border-trust-quarantined/30 text-trust-quarantined text-xs flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-trust-quarantined" />
            <span>Disconnected from Gateway. Live updates paused.</span>
          </div>
          <span className="font-mono text-[11px]">Offline</span>
        </div>
      )}

      {/* Header and Primary Compare Action */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-bold tracking-tight text-foreground">Observatory Overview</h2>
            {isMock && (
              <span className="text-[11px] font-mono font-medium px-2 py-0.5 rounded bg-accent-cyan/15 border border-accent-cyan/40 text-accent-cyan">
                SIMULATED (MOCK)
              </span>
            )}
          </div>
          <p className="text-sm text-muted mt-0.5">
            Realtime distributed clock verification and consensus health monitoring
          </p>
        </div>

        {/* Section D: Primary Action */}
        <div className="flex items-center gap-3 shrink-0">
          <Link
            to="/compare"
            data-testid="compare-demo-action"
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-accent-cyan text-background font-semibold text-sm hover:bg-accent-cyan/90 transition-all shadow-md active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
          >
            <span>Run the Before vs After demo</span>
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </div>

      {/* Section A: Network Summary Row */}
      <div
        data-testid="network-summary"
        className="grid grid-cols-1 md:grid-cols-4 gap-4 bg-card border border-border p-5 rounded-2xl shadow-sm"
      >
        {/* Health Score + Circular Ring */}
        <div className="flex items-center gap-4 border-b md:border-b-0 md:border-r border-border/60 pb-4 md:pb-0 md:pr-4">
          <div className="relative flex items-center justify-center shrink-0">
            <svg width={64} height={64} className="rotate-[-90deg]">
              <circle
                cx={32}
                cy={32}
                r={26}
                fill="transparent"
                stroke="#1F2B4A"
                strokeWidth={5}
              />
              <circle
                cx={32}
                cy={32}
                r={26}
                fill="transparent"
                stroke={
                  network
                    ? network.score >= 90
                      ? '#3DDC97'
                      : network.score >= 70
                      ? '#F5A524'
                      : '#FF5C5C'
                    : '#1F2B4A'
                }
                strokeWidth={5}
                strokeDasharray={163.36}
                strokeDashoffset={
                  network ? 163.36 - (Math.max(0, Math.min(100, network.score)) / 100) * 163.36 : 163.36
                }
                strokeLinecap="round"
                className="transition-all duration-500 ease-out"
              />
            </svg>
            <span className="absolute font-mono text-sm font-bold text-foreground tabular-nums">
              {network ? `${network.score}%` : '--'}
            </span>
          </div>

          <div>
            <div className="flex items-center gap-1 text-xs font-medium text-muted">
              <span>Network Health</span>
              <InfoTip text="Composite timing health based on active consensus, clock drift envelopes, and trusted nodes." />
            </div>
            <div className="text-lg font-bold text-foreground font-mono tabular-nums">
              {network ? `${network.score}%` : 'Unavailable'}
            </div>
            <span className="text-[11px] text-muted/80">
              {network ? `${network.trusted} of ${network.n} nodes trusted` : 'Awaiting snapshot'}
            </span>
          </div>
        </div>

        {/* Fault Tolerance */}
        <div className="flex flex-col justify-center border-b md:border-b-0 md:border-r border-border/60 pb-4 md:pb-0 md:pr-4">
          <div className="flex items-center gap-1 text-xs font-medium text-muted">
            <span>Byzantine Fault Tolerance</span>
            <InfoTip text="Calculated threshold f = floor((n - 1) / 3). Network maintains safe consensus as long as faulty nodes <= f." />
          </div>
          <div data-testid="fault-tolerance" className="text-sm font-semibold text-foreground mt-1">
            {network
              ? `Tolerates ${network.fault_tolerance_f} faulty of ${network.n} nodes`
              : 'Tolerates -- faulty of -- nodes'}
          </div>
          <span className="text-[11px] font-mono text-muted/80 mt-0.5">
            {network ? `Quarantined: ${network.quarantined} | Suspect: ${network.suspect}` : '--'}
          </span>
        </div>

        {/* Anchor Status Chip */}
        <div className="flex flex-col justify-center border-b md:border-b-0 md:border-r border-border/60 pb-4 md:pb-0 md:pr-4">
          <span className="text-xs font-medium text-muted">Reference Clocks</span>
          <div className="mt-1.5 flex items-center">
            <span
              data-testid="anchor-status-chip"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${
                anchorsOk
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  anchorsOk ? 'bg-emerald-400' : 'bg-rose-400 animate-pulse'
                }`}
              />
              {anchorsOk ? 'Anchors OK' : 'Anchors Unavailable'}
            </span>
          </div>
          <span className="text-[11px] text-muted/70 mt-1">NIST/UTC anchor signals</span>
        </div>

        {/* Connection Status Chip */}
        <div className="flex flex-col justify-center">
          <span className="text-xs font-medium text-muted">Telemetry Link</span>
          <div className="mt-1.5 flex items-center">
            <span
              data-testid="connection-status-chip"
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-mono font-medium border ${
                isMock
                  ? 'bg-accent-cyan/10 text-accent-cyan border-accent-cyan/30'
                  : connectionStatus === 'connected'
                  ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                  : isConnecting
                  ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                  : 'bg-rose-500/10 text-rose-400 border-rose-500/30'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isMock
                    ? 'bg-accent-cyan'
                    : connectionStatus === 'connected'
                    ? 'bg-emerald-400'
                    : isConnecting
                    ? 'bg-amber-400 animate-pulse'
                    : 'bg-rose-400'
                }`}
              />
              {isMock
                ? 'Mock (Simulated)'
                : connectionStatus === 'connected'
                ? 'Connected'
                : isConnecting
                ? 'Connecting'
                : 'Disconnected'}
            </span>
          </div>
          <span className="text-[11px] font-mono text-muted/70 mt-1">1 Hz WebSocket stream</span>
        </div>
      </div>

      {/* Section E: No-Real-Nodes Hint */}
      {!hasRealNodes && (
        <div
          data-testid="no-real-nodes-hint"
          className="bg-card/70 border border-border p-4 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
        >
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30 flex items-center justify-center font-bold text-accent-cyan shrink-0">
              📱
            </div>
            <div>
              <p className="font-semibold text-foreground text-sm">Add a real node: scan the QR.</p>
              <p className="text-muted text-xs">
                Participate in observatory time verification by connecting your browser or phone clock as an Ed25519 node.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={openQrModal}
            data-testid="open-qr-hint-button"
            className="px-3.5 py-2 rounded-lg bg-accent-cyan/15 hover:bg-accent-cyan/25 border border-accent-cyan/40 text-accent-cyan font-medium text-xs transition-colors shrink-0 focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
          >
            Scan QR Code
          </button>
        </div>
      )}

      {/* Stream Error Notice */}
      {error && (
        <div className="p-4 bg-trust-quarantined/10 border border-trust-quarantined/30 text-trust-quarantined rounded-xl text-xs flex items-center justify-between">
          <span>
            <strong>Stream Warning:</strong> {error}
          </span>
          <span className="font-mono text-[11px]">Auto-reconnecting</span>
        </div>
      )}

      {/* Section B: Node Cards Grid */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-foreground">
            Connected Nodes ({sortedNodes.length})
          </h3>
          <span className="text-xs text-muted font-mono">Sorted alphabetically</span>
        </div>

        {isLoading && sortedNodes.length === 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <Skeleton height={180} />
            <Skeleton height={180} />
            <Skeleton height={180} />
          </div>
        ) : sortedNodes.length === 0 ? (
          <EmptyState
            title="No Observatory Nodes Connected"
            description="Waiting for observatory nodes to register or telemetry stream to bootstrap."
            action={
              <button
                type="button"
                onClick={openQrModal}
                className="text-xs font-semibold text-accent-cyan hover:underline"
              >
                Scan QR to connect a node now →
              </button>
            }
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {sortedNodes.map((node) => (
              <NodeCard
                key={node.id}
                node={node}
                assessment={assessments[node.id]}
                history={assessmentHistory[node.id] || []}
              />
            ))}
          </div>
        )}
      </div>

      {/* Section C: Recent Transitions */}
      <div className="space-y-3 pt-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <h3 className="text-base font-semibold text-foreground">Recent State Transitions</h3>
            <InfoTip text="Audit log of node trust state changes decided by the E3b multi-stream timing verification engine." />
          </div>
          <span className="text-xs text-muted font-mono">Latest 5 events</span>
        </div>

        {displayedTransitions.length === 0 ? (
          <div
            data-testid="empty-transitions"
            className="p-5 rounded-xl bg-card border border-border text-center text-xs text-muted space-y-1"
          >
            <p className="font-medium text-foreground">No State Transitions Recorded</p>
            <p className="text-muted/80">Cluster trust envelope is calm and verified.</p>
          </div>
        ) : (
          <div data-testid="recent-transitions-list" className="space-y-2">
            {displayedTransitions.map((t, idx) => {
              const nodeName = nodeMap.get(t.node_id) || `Node ${t.node_id.slice(0, 8)}`;
              return (
                <div
                  key={`${t.node_id}-${t.at_ms}-${idx}`}
                  data-testid="transition-row"
                  className="bg-card border border-border/80 px-4 py-3 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-xs"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-foreground">{nodeName}</span>
                    <span className="text-muted/60">:</span>
                    <StateChip state={t.from} size="sm" showSymbol={true} showLabel={true} />
                    <span className="text-muted font-mono" aria-hidden="true">
                      →
                    </span>
                    <StateChip state={t.to} size="sm" showSymbol={true} showLabel={true} />
                    <span className="text-muted text-[11px] pl-1">
                      {formatTransitionReason(t.reasons)}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 shrink-0 font-mono text-[11px] text-muted">
                    <span>{formatSignedOffset(t.error_est_ms)}</span>
                    <span className="text-muted/40">•</span>
                    <span>{formatRelativeTime(t.at_ms)}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
