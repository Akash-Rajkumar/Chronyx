import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  useDashboardStore,
  useNode,
  useAssessment,
  useRecentTransitions,
  useNodeHistory,
  useIsLoading,
} from '../../state/useDashboardStore.js';
import { api } from '../../api/client.js';
import { StateChip, InfoTip, Skeleton } from '../../ui/index.js';
import type { NodeInfo, Assessment, Observation, HistoryPoint } from '@chronyx/contracts';

export function formatSignedOffset(offsetMs: number | null | undefined): string {
  if (offsetMs === null || offsetMs === undefined || Number.isNaN(offsetMs)) {
    return '0.000 ms';
  }
  const sign = offsetMs >= 0 ? '+' : '';
  return `${sign}${offsetMs.toFixed(3)} ms`;
}

export const NodeDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const [copiedKey, setCopiedKey] = useState(false);
  const [downloadingBundle, setDownloadingBundle] = useState(false);
  const [bundleError, setBundleError] = useState<string | null>(null);

  // In client (browser), use granular reactive selector hooks.
  // In SSR / Node test renderer, read current store state.
  const isClient = typeof window !== 'undefined';
  const storeState = isClient ? null : useDashboardStore.getState();

  const storeNodeHook = useNode(id);
  const storeAssessmentHook = useAssessment(id);
  const storeTransitionsHook = useRecentTransitions();
  const storeAssessmentHistoryHook = useNodeHistory(id);
  const isStoreLoadingHook = useIsLoading();

  const storeNode = isClient ? storeNodeHook : (id ? storeState!.nodes.find((n) => n.id === id) : undefined);
  const storeAssessment = isClient ? storeAssessmentHook : (id ? storeState!.assessments[id] : undefined);
  const storeTransitions = isClient ? storeTransitionsHook : storeState!.recentTransitions;
  const storeAssessmentHistory = isClient ? storeAssessmentHistoryHook : (id ? storeState!.assessmentHistory[id] || [] : []);
  const isStoreLoading = isClient ? isStoreLoadingHook : storeState!.isLoading;

  // Local state for fetched history / deep link fallback
  const [fetchedNode, setFetchedNode] = useState<NodeInfo | null>(null);
  const [fetchedAssessment, setFetchedAssessment] = useState<Assessment | null>(null);
  const [apiHistoryPoints, setApiHistoryPoints] = useState<HistoryPoint[]>([]);
  const [observations, setObservations] = useState<Observation[]>([]);
  const [isLoadingApi, setIsLoadingApi] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  const node = storeNode ?? fetchedNode;
  const assessment = storeAssessment ?? fetchedAssessment;

  // Filter transitions for this node
  const nodeTransitions = useMemo(() => {
    return storeTransitions.filter((t) => t.node_id === id);
  }, [storeTransitions, id]);

  // Combine history: from API points or store assessment history
  const historySeries = useMemo(() => {
    if (apiHistoryPoints.length > 0) {
      return apiHistoryPoints.map((p) => p.error_est_ms);
    }
    if (storeAssessmentHistory && storeAssessmentHistory.length > 0) {
      return storeAssessmentHistory;
    }
    return [];
  }, [apiHistoryPoints, storeAssessmentHistory]);

  // Fetch node history and fallback data if needed
  useEffect(() => {
    if (!id) return;
    let isCancelled = false;

    const loadData = async () => {
      setIsLoadingApi(true);
      setApiError(null);
      try {
        const promises: [
          Promise<{ node: NodeInfo; assessment: Assessment | null } | null>,
          Promise<{ points: HistoryPoint[] } | null>,
          Promise<Observation[] | null>,
        ] = [
          !storeNode ? api.getNode(id).catch(() => null) : Promise.resolve(null),
          api.getNodeHistory(id).catch(() => null),
          api.getObservations().catch(() => null),
        ];

        const [nodeRes, historyRes, obsRes] = await Promise.all(promises);

        if (!isCancelled) {
          if (nodeRes) {
            setFetchedNode(nodeRes.node);
            if (nodeRes.assessment && !storeAssessment) {
              setFetchedAssessment(nodeRes.assessment);
            }
          }
          if (historyRes && Array.isArray(historyRes.points)) {
            setApiHistoryPoints(historyRes.points);
          }
          if (obsRes && Array.isArray(obsRes)) {
            setObservations(obsRes.filter((o) => o.node_id === id));
          }
        }
      } catch (err) {
        if (!isCancelled) {
          setApiError((err as Error).message || 'Failed to fetch node details');
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingApi(false);
        }
      }
    };

    void loadData();

    return () => {
      isCancelled = true;
    };
  }, [id, storeNode, storeAssessment]);

  const copyKeyFingerprint = useCallback(() => {
    const key = node?.public_key;
    if (!key) return;
    navigator.clipboard?.writeText(key).then(() => {
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    }).catch(() => {
      // Fallback
      setCopiedKey(true);
      setTimeout(() => setCopiedKey(false), 2000);
    });
  }, [node]);

  const downloadEvidenceBundle = useCallback(async () => {
    if (!id) return;
    setDownloadingBundle(true);
    setBundleError(null);
    try {
      const bundle = await api.getNodeEvidenceBundle(id);
      const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `evidence-bundle-${id}-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setBundleError((err as Error).message || 'Failed to download evidence bundle');
    } finally {
      setDownloadingBundle(false);
    }
  }, [id]);

  // Loading state
  if ((isStoreLoading || isLoadingApi) && !node) {
    return (
      <div className="space-y-6" data-testid="node-detail-loading">
        <div className="flex items-center gap-4">
          <Skeleton className="h-6 w-24" />
          <Skeleton className="h-6 w-32" />
        </div>
        <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-6 w-20" />
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  // Not found or error state
  if (!node && !isLoadingApi) {
    return (
      <div className="space-y-6" data-testid="node-detail-not-found">
        <Link to="/" className="inline-flex items-center text-xs text-[#00E5FF] hover:underline font-mono">
          &larr; Back to Live Overview
        </Link>
        <div className="bg-[#111622] border border-[#EF4444]/30 rounded-xl p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-[#EF4444]/10 text-[#EF4444] flex items-center justify-center mx-auto mb-4 font-mono font-bold text-xl">
            !
          </div>
          <h2 className="text-lg font-bold text-slate-100 font-mono">Node Not Found</h2>
          <p className="text-sm text-slate-400 mt-2 max-w-md mx-auto">
            {apiError ? `Error: ${apiError}` : `The node with ID "${id}" could not be found in active state or backend records.`}
          </p>
          <div className="mt-6">
            <Link
              to="/"
              className="px-4 py-2 bg-[#1e2738] hover:bg-[#28354c] text-slate-200 text-xs font-mono rounded-lg transition-colors inline-block"
            >
              Return to Overview
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const isReal = node?.kind === 'browser';
  const hasAssessment = !!assessment;
  const confidence = assessment?.confidence ?? 0;
  const cusumVal = assessment?.cusum ?? 0;
  const driftZ = assessment?.z ?? 0;
  const lastActive = node?.last_seen_at ? new Date(node.last_seen_at).toLocaleTimeString() : 'Unknown';
  const keyStr = node?.public_key ?? 'Unavailable';
  const truncatedKey = keyStr.length > 22 ? `${keyStr.slice(0, 10)}...${keyStr.slice(-8)}` : keyStr;

  return (
    <div className="space-y-6" data-testid="node-detail-container">
      {/* Navigation & Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-xs text-[#00E5FF] hover:underline font-mono">
            &larr; Overview
          </Link>
          <span className="text-slate-600">/</span>
          <h1 className="text-xl font-bold font-mono text-slate-100 flex items-center gap-2">
            Node: {node?.name || node?.id || id}
          </h1>
          <span
            data-testid="node-kind-badge"
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase tracking-wider ${
              isReal
                ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                : 'bg-purple-500/10 text-purple-400 border border-purple-500/30'
            }`}
          >
            {isReal ? 'Real Node' : 'Virtual Node'}
          </span>
        </div>

        {/* Action button: Evidence Bundle */}
        <div className="flex items-center gap-2">
          <button
            onClick={downloadEvidenceBundle}
            disabled={downloadingBundle}
            data-testid="export-evidence-button"
            className="px-3 py-1.5 bg-[#161D2C] hover:bg-[#1E273A] border border-[#232E44] text-xs font-mono text-slate-200 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
            title="Download cryptographic audit bundle (.json)"
          >
            <svg className="w-3.5 h-3.5 text-[#00E5FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {downloadingBundle ? 'Exporting...' : 'Export Evidence Bundle'}
          </button>
        </div>
      </div>

      {bundleError && (
        <div className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg text-xs font-mono text-[#EF4444]">
          {bundleError}
        </div>
      )}

      {/* Identity & Status Card */}
      <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-5">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
          {/* Trust State */}
          <div className="bg-[#0b0e14] p-4 rounded-lg border border-[#171e2c]" data-testid="trust-state-section">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-400 font-mono">Trust Status</span>
              <InfoTip text="Evaluated state based on sequential CUSUM residual analysis, clock drift, and peer consensus." />
            </div>
            <div className="flex items-center gap-2 mt-1">
              {hasAssessment ? (
                <>
                  <StateChip state={assessment.state} />
                  <span className="text-xs font-mono text-slate-400" data-testid="confidence-value">
                    ({Math.round(confidence * 100)}% conf)
                  </span>
                </>
              ) : (
                <span
                  data-testid="state-chip"
                  className="inline-flex items-center gap-1 rounded-md font-mono text-[11px] px-2 py-0.5 border border-muted/30 bg-muted/10 text-muted"
                >
                  <span className="font-bold">■</span>
                  <span>Unassessed</span>
                </span>
              )}
            </div>
          </div>

          {/* Connection & Heartbeat */}
          <div className="bg-[#0b0e14] p-4 rounded-lg border border-[#171e2c]" data-testid="connection-status-section">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-400 font-mono">Connection Status</span>
              <span
                className={`w-2 h-2 rounded-full ${
                  node?.online ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                }`}
              />
            </div>
            <div className="text-sm font-mono text-slate-200 mt-1">
              {node?.online ? 'Online' : 'Offline'} (Last seen: {lastActive})
            </div>
          </div>

          {/* Public Key Fingerprint */}
          <div className="bg-[#0b0e14] p-4 rounded-lg border border-[#171e2c]" data-testid="key-fingerprint-section">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-400 font-mono">Public Key / Auth</span>
              <button
                onClick={copyKeyFingerprint}
                data-testid="copy-key-button"
                className="text-[10px] text-[#00E5FF] hover:underline font-mono"
                title="Copy public key"
              >
                {copiedKey ? 'Copied!' : 'Copy'}
              </button>
            </div>
            <div className="text-xs font-mono text-slate-300 truncate mt-1" title={keyStr} data-testid="public-key-display">
              {truncatedKey}
            </div>
          </div>

          {/* Residual / Drift Summary */}
          <div className="bg-[#0b0e14] p-4 rounded-lg border border-[#171e2c]" data-testid="residual-summary-section">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-slate-400 font-mono">Offset Estimate</span>
              <InfoTip text="Estimated clock offset relative to observatory consensus frame." />
            </div>
            <div className="text-sm font-mono text-slate-200 mt-1">
              {assessment?.error_est_ms != null ? formatSignedOffset(assessment.error_est_ms) : 'Calibrating'}
              {assessment?.sigma_ms != null && (
                <span className="text-xs text-slate-400 ml-1">
                  (&plusmn;{assessment.sigma_ms.toFixed(3)} ms)
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* CUSUM and Statistical Drift Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-5" data-testid="cusum-indicator">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-mono font-semibold text-slate-200">
                CUSUM Accumulator
              </h3>
              <InfoTip text="Page's Cumulative Sum statistical quality control chart. Detects sudden mean shifts in clock phase residual. Flag threshold h = 4.0\u03C3." />
            </div>
            <span className={`text-xs font-mono px-2 py-0.5 rounded ${
              Math.abs(cusumVal) > 4.0 ? 'bg-[#EF4444]/20 text-[#EF4444] border border-[#EF4444]/40' : 'bg-[#00E5FF]/10 text-[#00E5FF]'
            }`}>
              Threshold h = 4.0&sigma;
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-400">Current Value:</span>
              <span className="text-slate-200 font-semibold" data-testid="cusum-value">{cusumVal.toFixed(2)}&sigma;</span>
            </div>
            <div className="w-full bg-[#1b2332] rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  Math.abs(cusumVal) > 4.0 ? 'bg-[#EF4444]' : 'bg-[#00E5FF]'
                }`}
                style={{ width: `${Math.min(100, (Math.abs(cusumVal) / 4.0) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {Math.abs(cusumVal) > 4.0
                ? 'Flagged: Accumulator exceeds decision boundary! Potential clock spoof or severe step detected.'
                : 'Nominal: Residual accumulation within normal Brownian perturbation limits.'}
            </p>
          </div>
        </div>

        <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-5" data-testid="drift-z-indicator">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-mono font-semibold text-slate-200">
                Robust Z-Score (MAD)
              </h3>
              <InfoTip text="Median Absolute Deviation normalized residual score. Robust to burst outlier corruption. Flag threshold |z| = 3.0." />
            </div>
            <span className={`text-xs font-mono px-2 py-0.5 rounded ${
              Math.abs(driftZ) > 3.0 ? 'bg-[#F59E0B]/20 text-[#F59E0B] border border-[#F59E0B]/40' : 'bg-[#00E5FF]/10 text-[#00E5FF]'
            }`}>
              Threshold |z| = 3.0
            </span>
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-xs font-mono">
              <span className="text-slate-400">Current Drift Score:</span>
              <span className="text-slate-200 font-semibold" data-testid="drift-z-value">{driftZ.toFixed(2)}</span>
            </div>
            <div className="w-full bg-[#1b2332] rounded-full h-2 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  Math.abs(driftZ) > 3.0 ? 'bg-[#F59E0B]' : 'bg-[#00E5FF]'
                }`}
                style={{ width: `${Math.min(100, (Math.abs(driftZ) / 3.0) * 100)}%` }}
              />
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {Math.abs(driftZ) > 3.0
                ? 'Anomaly detected: Node timing residual deviates significantly from the observatory median.'
                : 'Within tolerance: Timing error consistent with synchronized cluster reference.'}
            </p>
          </div>
        </div>
      </div>

      {/* Multi-Stream Timing Decomposition */}
      <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-5" data-testid="multi-stream-decomposition">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-mono font-semibold text-slate-200 flex items-center gap-2">
              Multi-Stream Timing Decomposition
              <InfoTip text="Chronyx synthesizes 4 independent timing streams. Real browser nodes provide Peer and Oscillator data; GNSS and Optical Camera streams are simulated or hardware-node specific." />
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Independent timing references contributing to state estimation
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Stream 1: Peer Inter-node Round-trip */}
          <div className="bg-[#0b0e14] p-3.5 rounded-lg border border-[#171e2c]" data-testid="stream-peer">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-slate-300">1. Peer WebRTC RTT</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Active
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              High-frequency peer delay measurement via cross-link timestamps.
            </p>
            <div className="mt-3 text-xs font-mono text-slate-300">
              Weight: <span className="text-[#00E5FF]">35%</span>
            </div>
          </div>

          {/* Stream 2: Local Hardware Oscillator */}
          <div className="bg-[#0b0e14] p-3.5 rounded-lg border border-[#171e2c]" data-testid="stream-oscillator">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-slate-300">2. Local Oscillator</span>
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                Active
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              Browser performance.now() high-resolution monotonic clock drift model.
            </p>
            <div className="mt-3 text-xs font-mono text-slate-300">
              Weight: <span className="text-[#00E5FF]">25%</span>
            </div>
          </div>

          {/* Stream 3: GNSS Carrier Phase / PPS */}
          <div
            data-testid="stream-gnss"
            className={`p-3.5 rounded-lg border ${
              isReal
                ? 'bg-[#0b0e14]/50 border-[#171e2c]/60 opacity-60'
                : 'bg-[#0b0e14] border-[#171e2c]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-slate-300">3. GNSS PPS / Phase</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                isReal
                  ? 'bg-slate-700/30 text-slate-400 border border-slate-700/50'
                  : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
              }`}>
                {isReal ? 'Not Equipped (Virtual Nodes Only)' : 'Active (Sim)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {isReal
                ? 'Standard browsers lack direct GNSS hardware PPS access.'
                : 'Simulated sub-nanosecond GNSS carrier-phase anchor reference.'}
            </p>
            <div className="mt-3 text-xs font-mono text-slate-300">
              Weight: <span className={isReal ? 'text-slate-500' : 'text-[#00E5FF]'}>{isReal ? '0%' : '25%'}</span>
            </div>
          </div>

          {/* Stream 4: Camera / Optical Anchor */}
          <div
            data-testid="stream-camera"
            className={`p-3.5 rounded-lg border ${
              isReal
                ? 'bg-[#0b0e14]/50 border-[#171e2c]/60 opacity-60'
                : 'bg-[#0b0e14] border-[#171e2c]'
            }`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-semibold text-slate-300">4. Optical Camera</span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${
                isReal
                  ? 'bg-slate-700/30 text-slate-400 border border-slate-700/50'
                  : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
              }`}>
                {isReal ? 'Not Equipped (Virtual Nodes Only)' : 'Active (Sim)'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-1">
              {isReal
                ? 'Optical strobe verification not enabled on this client.'
                : 'Strobe synchronization pulse detection via high-speed sensor.'}
            </p>
            <div className="mt-3 text-xs font-mono text-slate-300">
              Weight: <span className={isReal ? 'text-slate-500' : 'text-[#00E5FF]'}>{isReal ? '0%' : '15%'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Residual Error Time-Series */}
      <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-5" data-testid="residual-timeseries-section">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-sm font-mono font-semibold text-slate-200 flex items-center gap-2">
              Timing Residual Error Over Time (ms)
              <InfoTip text="Time difference between this node's clock and the observatory consensus frame. Calibrating state shown when fewer than 2 live data points exist." />
            </h3>
            <p className="text-xs text-slate-400 mt-0.5">
              Sequence of assessed residual deviations
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400" data-testid="sample-count">
            {historySeries.length} samples
          </span>
        </div>

        {historySeries.length < 2 ? (
          <div
            data-testid="calibrating-state"
            className="h-48 border border-dashed border-[#1e2738] rounded-lg flex flex-col items-center justify-center p-6 text-center bg-[#0b0e14]/40"
          >
            <div className="w-8 h-8 rounded-full border-2 border-[#00E5FF] border-t-transparent animate-spin mb-3" />
            <span className="text-sm font-mono font-medium text-slate-300">
              Calibrating Observatory Baseline
            </span>
            <p className="text-xs text-slate-500 mt-1 max-w-sm">
              Residual chart requires at least 2 historical consensus points. Awaiting subsequent telemetry packets...
            </p>
          </div>
        ) : (
          <div className="space-y-4" data-testid="timeseries-chart">
            <div className="h-48 w-full bg-[#0b0e14] rounded-lg p-3 border border-[#171e2c] relative flex flex-col justify-between">
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 500 150">
                {/* Zero line */}
                <line x1="0" y1="75" x2="500" y2="75" stroke="#1e2738" strokeWidth="1" strokeDasharray="4 4" />

                {/* Residual line */}
                {(() => {
                  const maxRes = Math.max(...historySeries.map((v) => Math.abs(v)), 0.001);
                  const points = historySeries.map((v, idx) => {
                    const x = (idx / (historySeries.length - 1)) * 500;
                    const y = 75 - (v / maxRes) * 65;
                    return `${x},${y}`;
                  }).join(' ');

                  return (
                    <polyline
                      fill="none"
                      stroke="#00E5FF"
                      strokeWidth="2"
                      points={points}
                    />
                  );
                })()}
              </svg>
              <div className="flex justify-between text-[10px] font-mono text-slate-500 px-1 pt-2 border-t border-[#171e2c]">
                <span>T-{historySeries.length} ticks</span>
                <span>0.000 ms center</span>
                <span>Current</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Trust State History Timeline */}
      <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-5" data-testid="transitions-history-section">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-mono font-semibold text-slate-200 flex items-center gap-2">
            Trust State Transitions & Event History
            <InfoTip text="Audit log of automated transitions triggered by the Bayesian/CUSUM state machine." />
          </h3>
          <span className="text-xs font-mono text-slate-400" data-testid="transition-count">
            {nodeTransitions.length} transitions
          </span>
        </div>

        {nodeTransitions.length === 0 ? (
          <div data-testid="transitions-empty" className="p-6 bg-[#0b0e14] rounded-lg border border-[#171e2c] text-center text-xs font-mono text-slate-500">
            No state transitions recorded for this node. Operating in initial assessed state.
          </div>
        ) : (
          <div className="space-y-2" data-testid="transitions-list">
            {nodeTransitions.map((t, i) => (
              <div
                key={i}
                data-testid={`transition-item-${i}`}
                className="p-3 bg-[#0b0e14] rounded-lg border border-[#171e2c] flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono text-slate-400">
                    {new Date(t.at_ms).toLocaleTimeString()}
                  </span>
                  <span className="text-slate-600">&bull;</span>
                  <span className="text-xs font-mono text-slate-300">
                    <span className="font-semibold">{t.from}</span> &rarr; <span className="font-semibold text-[#00E5FF]">{t.to}</span>
                  </span>
                </div>
                <div className="text-xs font-mono text-slate-400">
                  {t.reasons.length > 0 ? t.reasons.join(', ') : 'Automated state machine evaluation'}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Observations / Evidence list if available */}
      {observations.length > 0 && (
        <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-5" data-testid="observations-section">
          <h3 className="text-sm font-mono font-semibold text-slate-200 mb-3 flex items-center gap-2">
            Recent Telemetry Observations ({observations.length})
            <InfoTip text="Signed observation packets submitted across peer timing channels." />
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="text-slate-400 border-b border-[#171e2c]">
                <tr>
                  <th className="pb-2">Time</th>
                  <th className="pb-2">Kind</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2">Confidence</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#171e2c] text-slate-300">
                {observations.slice(0, 5).map((obs, idx) => (
                  <tr key={idx} className="hover:bg-[#161d2c]/50">
                    <td className="py-2">{new Date(obs.observed_at_ms).toLocaleTimeString()}</td>
                    <td className="py-2">{obs.kind}</td>
                    <td className="py-2 capitalize">{obs.status}</td>
                    <td className="py-2">{(obs.confidence * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};
