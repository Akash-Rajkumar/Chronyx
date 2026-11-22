import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import type {
  IncidentSummary,
  Incident,
  SuspectedCause,
} from '@chronyx/contracts';
import {
  useDashboardStore,
  useOpenIncidents,
  useNodes,
  useConnectionStatus,
  useIsLoading,
} from '../../state/useDashboardStore.js';
import { api } from '../../api/client.js';
import { InfoTip, Skeleton, EmptyState } from '../../ui/index.js';

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

export function calculateSeverity(peakErrorMs: number, cause?: SuspectedCause | string): {
  severity: IncidentSeverity;
  label: string;
  badgeClass: string;
} {
  const absError = Math.abs(peakErrorMs);
  if (absError >= 10 || cause === 'gnss_spoof') {
    return {
      severity: 'critical',
      label: 'Critical',
      badgeClass: 'bg-rose-500/10 text-rose-400 border-rose-500/30',
    };
  }
  if (absError >= 5 || cause === 'local_clock') {
    return {
      severity: 'high',
      label: 'High',
      badgeClass: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
    };
  }
  if (absError >= 1 || cause === 'camera_path' || cause === 'network') {
    return {
      severity: 'medium',
      label: 'Medium',
      badgeClass: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/30',
    };
  }
  return {
    severity: 'low',
    label: 'Low',
    badgeClass: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  };
}

export function formatDuration(openedAtMs: number, closedAtMs: number | null, nowMs = Date.now()): string {
  const end = closedAtMs ?? nowMs;
  const diffSec = Math.max(0, Math.floor((end - openedAtMs) / 1000));
  if (diffSec < 60) return `${diffSec}s`;
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  if (mins < 60) return `${mins}m ${secs}s`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hours}h ${remMins}m`;
}

export const CAUSE_LABELS: Record<string, string> = {
  none: 'No Specific Cause',
  local_clock: 'Local Clock Drift / Step',
  gnss_spoof: 'GNSS Carrier Spoofing',
  camera_path: 'Optical Delay / Frame Strobe',
  network: 'Network Asymmetry / Peer Outlier',
  unknown: 'Undetermined Anomaly',
};

export function formatSignedOffset(offsetMs: number | null | undefined): string {
  if (offsetMs === null || offsetMs === undefined || Number.isNaN(offsetMs)) {
    return '0.000 ms';
  }
  const sign = offsetMs >= 0 ? '+' : '';
  return `${sign}${offsetMs.toFixed(3)} ms`;
}

export function IncidentsPage() {
  // SSR-safe store access matching OverviewPage & NodeDetailPage
  const isClient = typeof window !== 'undefined';
  const storeState = isClient ? null : useDashboardStore.getState();

  const storeOpenIncidentsHook = useOpenIncidents();
  const storeNodesHook = useNodes();
  const connectionStatusHook = useConnectionStatus();
  const isStoreLoadingHook = useIsLoading();

  const storeOpenIncidents = isClient ? storeOpenIncidentsHook : storeState!.openIncidents;
  const storeNodes = isClient ? storeNodesHook : storeState!.nodes;
  const connectionStatus = isClient ? connectionStatusHook : storeState!.connectionStatus;
  const isStoreLoading = isClient ? isStoreLoadingHook : storeState!.isLoading;

  // Local state for fetched incidents & UI filters
  const [fetchedIncidents, setFetchedIncidents] = useState<IncidentSummary[]>([]);
  const [isLoadingApi, setIsLoadingApi] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Filter state
  const [statusFilter, setStatusFilter] = useState<'all' | 'open' | 'closed'>('all');
  const [severityFilter, setSeverityFilter] = useState<string>('all');
  const [nodeFilter, setNodeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected incident for detail drawer
  const [selectedIncidentId, setSelectedIncidentId] = useState<string | null>(null);
  const [incidentDetail, setIncidentDetail] = useState<Incident | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [copiedHash, setCopiedHash] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  // Load all incidents from REST endpoint
  const loadIncidents = useCallback(async () => {
    setIsLoadingApi(true);
    setApiError(null);
    try {
      const data = await api.getIncidents('all', 100);
      if (Array.isArray(data)) {
        setFetchedIncidents(data);
      }
    } catch (err) {
      setApiError((err as Error).message || 'Failed to fetch incident log');
    } finally {
      setIsLoadingApi(false);
    }
  }, []);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents]);

  // Combine store open incidents and fetched incidents (deduplicating by id)
  const allIncidents = useMemo(() => {
    const map = new Map<string, IncidentSummary>();
    for (const inc of fetchedIncidents) {
      map.set(inc.id, inc);
    }
    // Store open incidents take precedence for live updates
    for (const inc of storeOpenIncidents) {
      map.set(inc.id, inc);
    }
    return Array.from(map.values()).sort((a, b) => b.opened_at_ms - a.opened_at_ms);
  }, [fetchedIncidents, storeOpenIncidents]);

  // Distinct nodes for filter dropdown
  const nodeOptions = useMemo(() => {
    const set = new Map<string, string>();
    for (const inc of allIncidents) {
      set.set(inc.node_id, inc.node_name);
    }
    for (const n of storeNodes) {
      set.set(n.id, n.name);
    }
    return Array.from(set.entries()).map(([id, name]) => ({ id, name }));
  }, [allIncidents, storeNodes]);

  // Filtered incidents
  const filteredIncidents = useMemo(() => {
    return allIncidents.filter((inc) => {
      // Status filter
      if (statusFilter !== 'all' && inc.status !== statusFilter) {
        return false;
      }
      // Node filter
      if (nodeFilter !== 'all' && inc.node_id !== nodeFilter) {
        return false;
      }
      // Severity filter
      if (severityFilter !== 'all') {
        const { severity } = calculateSeverity(inc.peak_error_ms, inc.cause);
        if (severity !== severityFilter) {
          return false;
        }
      }
      // Text search
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchId = inc.id.toLowerCase().includes(q);
        const matchNode = inc.node_name.toLowerCase().includes(q);
        const matchCause = (CAUSE_LABELS[inc.cause] || inc.cause).toLowerCase().includes(q);
        if (!matchId && !matchNode && !matchCause) {
          return false;
        }
      }
      return true;
    });
  }, [allIncidents, statusFilter, nodeFilter, severityFilter, searchQuery]);

  // Load incident detail when selected
  useEffect(() => {
    if (!selectedIncidentId) {
      setIncidentDetail(null);
      setDetailError(null);
      return;
    }

    let isCancelled = false;
    const fetchDetail = async () => {
      setIsLoadingDetail(true);
      setDetailError(null);
      try {
        const detail = await api.getIncident(selectedIncidentId);
        if (!isCancelled) {
          setIncidentDetail(detail);
        }
      } catch (err) {
        if (!isCancelled) {
          // If detailed incident API is unavailable, fall back to summary from allIncidents
          const summary = allIncidents.find((i) => i.id === selectedIncidentId);
          if (summary) {
            setIncidentDetail({
              ...summary,
              summary: `Automated detection for node ${summary.node_name}. Suspected cause: ${CAUSE_LABELS[summary.cause] || summary.cause}.`,
              timeline: [],
              evidence: {
                assessments: [],
                chain_head_hash: 'Unavailable (Offline)',
                anchors: [],
                fault: null,
              },
            });
          } else {
            setDetailError((err as Error).message || 'Failed to load incident details');
          }
        }
      } finally {
        if (!isCancelled) {
          setIsLoadingDetail(false);
        }
      }
    };

    void fetchDetail();

    return () => {
      isCancelled = true;
    };
  }, [selectedIncidentId, allIncidents]);

  // Keyboard close for drawer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && selectedIncidentId) {
        setSelectedIncidentId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedIncidentId]);

  const copyHash = useCallback((hash: string) => {
    navigator.clipboard?.writeText(hash).then(() => {
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    }).catch(() => {
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    });
  }, []);

  const downloadIncidentEvidence = useCallback(async (id: string) => {
    setIsExporting(true);
    setExportError(null);
    try {
      let exportData: Record<string, unknown>;
      try {
        exportData = await api.exportIncident(id);
      } catch {
        // Fall back to getIncident if dedicated export endpoint is missing
        exportData = (incidentDetail ?? (await api.getIncident(id))) as unknown as Record<string, unknown>;
      }
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `incident-${id}-evidence.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setExportError((err as Error).message || 'Failed to export incident evidence');
    } finally {
      setIsExporting(false);
    }
  }, [incidentDetail]);

  const openCount = useMemo(() => allIncidents.filter((i) => i.status === 'open').length, [allIncidents]);
  const closedCount = useMemo(() => allIncidents.filter((i) => i.status === 'closed').length, [allIncidents]);

  return (
    <div className="space-y-6" data-testid="incidents-page">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold font-mono tracking-tight text-slate-100 flex items-center gap-2">
            Incident Log
            <InfoTip text="Audit record of timing anomalies, CUSUM drift detections, quarantine events, and cryptographic evidence trails." />
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Realtime anomaly tracking &bull; {openCount} active, {closedCount} resolved
          </p>
        </div>

        {/* Refresh button */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => void loadIncidents()}
            disabled={isLoadingApi}
            data-testid="refresh-incidents-button"
            className="px-3 py-1.5 bg-[#161D2C] hover:bg-[#1E273A] border border-[#232E44] text-xs font-mono text-slate-200 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
          >
            <svg
              className={`w-3.5 h-3.5 text-[#00E5FF] ${isLoadingApi ? 'animate-spin' : ''}`}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            Refresh Log
          </button>
        </div>
      </div>

      {/* Disconnection Banner if Gateway is offline */}
      {connectionStatus === 'disconnected' && (
        <div
          data-testid="incidents-disconnected-banner"
          className="p-3 rounded-xl bg-[#EF4444]/10 border border-[#EF4444]/30 text-[#EF4444] text-xs font-mono flex items-center justify-between"
        >
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-[#EF4444]" />
            <span>Gateway Disconnected. Displaying cached incident history.</span>
          </div>
          <span className="text-[11px] uppercase">Offline</span>
        </div>
      )}

      {/* API Error Notification */}
      {apiError && (
        <div
          data-testid="incidents-error-banner"
          className="p-3 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg text-xs font-mono text-[#EF4444] flex items-center justify-between"
        >
          <span>Error loading incidents from Gateway: {apiError}</span>
          <button
            onClick={() => void loadIncidents()}
            className="text-xs underline hover:text-[#EF4444]/80 ml-2"
          >
            Retry
          </button>
        </div>
      )}

      {/* Summary KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-4">
          <span className="text-xs text-slate-400 font-mono block">Total Incidents</span>
          <span className="text-2xl font-bold font-mono text-slate-100 mt-1 block" data-testid="kpi-total">
            {allIncidents.length}
          </span>
        </div>

        <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-4">
          <span className="text-xs text-slate-400 font-mono block">Active Anomalies</span>
          <span
            className={`text-2xl font-bold font-mono mt-1 block ${openCount > 0 ? 'text-[#EF4444]' : 'text-emerald-400'}`}
            data-testid="kpi-open"
          >
            {openCount}
          </span>
        </div>

        <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-4">
          <span className="text-xs text-slate-400 font-mono block">Resolved Incidents</span>
          <span className="text-2xl font-bold font-mono text-slate-300 mt-1 block" data-testid="kpi-closed">
            {closedCount}
          </span>
        </div>

        <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-4">
          <span className="text-xs text-slate-400 font-mono block">Peak Error Observed</span>
          <span className="text-2xl font-bold font-mono text-slate-100 mt-1 block" data-testid="kpi-peak">
            {allIncidents.length > 0
              ? formatSignedOffset(Math.max(...allIncidents.map((i) => Math.abs(i.peak_error_ms))))
              : '0.000 ms'}
          </span>
        </div>
      </div>

      {/* Filters Bar */}
      <div className="bg-[#111622] border border-[#1e2738] rounded-xl p-4 space-y-3">
        <div className="flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
          {/* Status Tabs */}
          <div className="flex items-center gap-1 bg-[#0b0e14] p-1 rounded-lg border border-[#171e2c]" role="tablist">
            <button
              onClick={() => setStatusFilter('all')}
              data-testid="filter-status-all"
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                statusFilter === 'all'
                  ? 'bg-[#1e2738] text-[#00E5FF] font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              All ({allIncidents.length})
            </button>
            <button
              onClick={() => setStatusFilter('open')}
              data-testid="filter-status-open"
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                statusFilter === 'open'
                  ? 'bg-[#1e2738] text-[#EF4444] font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Open ({openCount})
            </button>
            <button
              onClick={() => setStatusFilter('closed')}
              data-testid="filter-status-closed"
              className={`px-3 py-1 rounded text-xs font-mono transition-colors ${
                statusFilter === 'closed'
                  ? 'bg-[#1e2738] text-emerald-400 font-semibold'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Resolved ({closedCount})
            </button>
          </div>

          {/* Search Input */}
          <div className="relative flex-1 max-w-xs">
            <input
              type="text"
              placeholder="Search by ID, node, cause..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="incidents-search-input"
              className="w-full bg-[#0b0e14] border border-[#171e2c] text-xs font-mono text-slate-200 rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:border-[#00E5FF]/50"
            />
            <svg
              className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-2.5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>

        {/* Dropdowns row: Node & Severity */}
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-[#171e2c]">
          {/* Node Filter */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400">Node:</span>
            <select
              value={nodeFilter}
              onChange={(e) => setNodeFilter(e.target.value)}
              data-testid="filter-node-select"
              aria-label="Filter by node"
              className="bg-[#0b0e14] border border-[#171e2c] text-xs font-mono text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-[#00E5FF]/50"
            >
              <option value="all">All Nodes</option>
              {nodeOptions.map((opt) => (
                <option key={opt.id} value={opt.id}>
                  {opt.name}
                </option>
              ))}
            </select>
          </div>

          {/* Severity Filter */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400">Severity:</span>
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              data-testid="filter-severity-select"
              aria-label="Filter by severity"
              className="bg-[#0b0e14] border border-[#171e2c] text-xs font-mono text-slate-200 rounded-lg px-2.5 py-1 focus:outline-none focus:border-[#00E5FF]/50"
            >
              <option value="all">All Severities</option>
              <option value="critical">Critical (&ge;10ms or Spoof)</option>
              <option value="high">High (&ge;5ms or Clock Step)</option>
              <option value="medium">Medium (&ge;1ms or Network)</option>
              <option value="low">Low (&lt;1ms)</option>
            </select>
          </div>

          {/* Clear filters if active */}
          {(statusFilter !== 'all' || nodeFilter !== 'all' || severityFilter !== 'all' || searchQuery) && (
            <button
              onClick={() => {
                setStatusFilter('all');
                setNodeFilter('all');
                setSeverityFilter('all');
                setSearchQuery('');
              }}
              data-testid="clear-filters-button"
              className="text-[11px] font-mono text-[#00E5FF] hover:underline ml-auto"
            >
              Clear Filters
            </button>
          )}
        </div>
      </div>

      {/* Incident List Table */}
      <div className="bg-[#111622] border border-[#1e2738] rounded-xl overflow-hidden">
        {/* Loading Skeletons */}
        {(isLoadingApi || isStoreLoading) && allIncidents.length === 0 ? (
          <div className="p-6 space-y-4" data-testid="incidents-loading-state">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-full" />
          </div>
        ) : filteredIncidents.length === 0 ? (
          <div className="p-8" data-testid="incidents-empty-state">
            <EmptyState
              title={
                allIncidents.length === 0
                  ? 'No Incidents Recorded'
                  : 'No Matching Incidents Found'
              }
              description={
                allIncidents.length === 0
                  ? 'The cluster is running nominally with no clock anomalies or quarantine events.'
                  : 'Adjust or clear your filters to view other recorded incidents.'
              }
              action={
                allIncidents.length > 0 ? (
                  <button
                    onClick={() => {
                      setStatusFilter('all');
                      setNodeFilter('all');
                      setSeverityFilter('all');
                      setSearchQuery('');
                    }}
                    className="px-3 py-1.5 bg-[#1e2738] hover:bg-[#28354c] text-xs font-mono text-slate-200 rounded-lg transition-colors"
                  >
                    Reset Filters
                  </button>
                ) : undefined
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-[#0b0e14] text-slate-400 border-b border-[#1e2738]">
                <tr>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Severity</th>
                  <th className="py-3 px-4">Node</th>
                  <th className="py-3 px-4">Suspected Cause</th>
                  <th className="py-3 px-4">Peak Error</th>
                  <th className="py-3 px-4">Latency</th>
                  <th className="py-3 px-4">Detected</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#171e2c] text-slate-300">
                {filteredIncidents.map((inc) => {
                  const { label: sevLabel, badgeClass } = calculateSeverity(inc.peak_error_ms, inc.cause);
                  const isSelected = selectedIncidentId === inc.id;
                  const isOpen = inc.status === 'open';

                  return (
                    <tr
                      key={inc.id}
                      data-testid={`incident-row-${inc.id}`}
                      className={`hover:bg-[#161d2c]/60 transition-colors ${
                        isSelected ? 'bg-[#161d2c] border-l-2 border-[#00E5FF]' : ''
                      }`}
                    >
                      {/* Status */}
                      <td className="py-3 px-4">
                        <span
                          data-testid="incident-status-chip"
                          className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-[10px] font-semibold uppercase ${
                            isOpen
                              ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                              : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isOpen ? 'bg-rose-400 animate-pulse' : 'bg-emerald-400'
                            }`}
                          />
                          {inc.status}
                        </span>
                      </td>

                      {/* Severity */}
                      <td className="py-3 px-4">
                        <span
                          data-testid="incident-severity-badge"
                          className={`px-2 py-0.5 rounded text-[10px] font-semibold border ${badgeClass}`}
                        >
                          {sevLabel}
                        </span>
                      </td>

                      {/* Node Name & Link */}
                      <td className="py-3 px-4 font-semibold text-slate-100">
                        <Link
                          to={`/nodes/${inc.node_id}`}
                          className="hover:text-[#00E5FF] transition-colors"
                          title={`View details for node ${inc.node_name}`}
                        >
                          {inc.node_name}
                        </Link>
                      </td>

                      {/* Cause */}
                      <td className="py-3 px-4 text-slate-300">
                        {CAUSE_LABELS[inc.cause] || inc.cause}
                      </td>

                      {/* Peak Error */}
                      <td className="py-3 px-4 font-semibold text-slate-200">
                        {formatSignedOffset(inc.peak_error_ms)}
                      </td>

                      {/* Latency */}
                      <td className="py-3 px-4 text-slate-400">
                        {inc.detection_latency_s != null
                          ? `${inc.detection_latency_s.toFixed(1)}s`
                          : 'N/A'}
                      </td>

                      {/* Opened Timestamp */}
                      <td className="py-3 px-4 text-slate-400">
                        {new Date(inc.opened_at_ms).toLocaleTimeString()}
                      </td>

                      {/* Duration */}
                      <td className="py-3 px-4 text-slate-400">
                        {formatDuration(inc.opened_at_ms, inc.closed_at_ms)}
                      </td>

                      {/* Action */}
                      <td className="py-3 px-4 text-right">
                        <button
                          onClick={() => setSelectedIncidentId(inc.id)}
                          data-testid={`view-incident-${inc.id}`}
                          className="px-2.5 py-1 rounded bg-[#1e2738] hover:bg-[#28354c] text-[#00E5FF] text-[11px] font-medium transition-colors"
                        >
                          Details &rarr;
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Incident Detail Drawer */}
      {selectedIncidentId && (
        <div
          data-testid="incident-detail-drawer"
          className="fixed inset-y-0 right-0 w-full max-w-xl bg-[#0b0e14] border-l border-[#1e2738] shadow-2xl z-50 p-6 overflow-y-auto space-y-6"
        >
          {/* Drawer Header */}
          <div className="flex items-start justify-between border-b border-[#171e2c] pb-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono text-slate-500">Incident</span>
                <span className="text-xs font-mono text-[#00E5FF] truncate max-w-[200px]" title={selectedIncidentId}>
                  {selectedIncidentId}
                </span>
              </div>
              <h2 className="text-lg font-bold font-mono text-slate-100 mt-1">
                {incidentDetail?.node_name || 'Loading details...'}
              </h2>
            </div>
            <button
              onClick={() => setSelectedIncidentId(null)}
              data-testid="close-drawer-button"
              className="p-1 rounded text-slate-400 hover:text-slate-100 hover:bg-[#1e2738] transition-colors"
              aria-label="Close detail panel"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {isLoadingDetail ? (
            <div className="space-y-4">
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : detailError ? (
            <div className="p-4 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded-lg text-xs font-mono text-[#EF4444]">
              {detailError}
            </div>
          ) : incidentDetail ? (
            <div className="space-y-6">
              {/* Status and Action Row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span
                    className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold uppercase ${
                      incidentDetail.status === 'open'
                        ? 'bg-rose-500/10 text-rose-400 border border-rose-500/30'
                        : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/30'
                    }`}
                  >
                    {incidentDetail.status}
                  </span>
                  {(() => {
                    const { label, badgeClass } = calculateSeverity(incidentDetail.peak_error_ms, incidentDetail.cause);
                    return (
                      <span className={`px-2 py-0.5 rounded text-[10px] font-mono font-semibold border ${badgeClass}`}>
                        {label} Severity
                      </span>
                    );
                  })()}
                </div>

                {/* Export Evidence Bundle */}
                <button
                  onClick={() => void downloadIncidentEvidence(incidentDetail.id)}
                  disabled={isExporting}
                  data-testid="export-incident-evidence-button"
                  className="px-3 py-1.5 bg-[#161D2C] hover:bg-[#1E273A] border border-[#232E44] text-xs font-mono text-slate-200 rounded-lg flex items-center gap-1.5 transition-colors disabled:opacity-50"
                  title="Download cryptographic audit bundle"
                >
                  <svg className="w-3.5 h-3.5 text-[#00E5FF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {isExporting ? 'Exporting...' : 'Export Audit Bundle'}
                </button>
              </div>

              {exportError && (
                <div className="p-2 bg-[#EF4444]/10 border border-[#EF4444]/30 rounded text-xs font-mono text-[#EF4444]">
                  {exportError}
                </div>
              )}

              {/* Metrics Grid */}
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[#111622] p-3 rounded-lg border border-[#171e2c]">
                  <span className="text-[11px] font-mono text-slate-400 block">Peak Timing Error</span>
                  <span className="text-base font-bold font-mono text-slate-100 mt-0.5 block" data-testid="detail-peak-error">
                    {formatSignedOffset(incidentDetail.peak_error_ms)}
                  </span>
                </div>

                <div className="bg-[#111622] p-3 rounded-lg border border-[#171e2c]">
                  <span className="text-[11px] font-mono text-slate-400 block">Detection Latency</span>
                  <span className="text-base font-bold font-mono text-slate-100 mt-0.5 block" data-testid="detail-latency">
                    {incidentDetail.detection_latency_s != null ? `${incidentDetail.detection_latency_s.toFixed(2)}s` : 'N/A'}
                  </span>
                </div>

                <div className="bg-[#111622] p-3 rounded-lg border border-[#171e2c]">
                  <span className="text-[11px] font-mono text-slate-400 block">Detected Timestamp</span>
                  <span className="text-xs font-mono text-slate-300 mt-1 block">
                    {new Date(incidentDetail.opened_at_ms).toLocaleString()}
                  </span>
                </div>

                <div className="bg-[#111622] p-3 rounded-lg border border-[#171e2c]">
                  <span className="text-[11px] font-mono text-slate-400 block">Duration</span>
                  <span className="text-xs font-mono text-slate-300 mt-1 block">
                    {formatDuration(incidentDetail.opened_at_ms, incidentDetail.closed_at_ms)}
                  </span>
                </div>
              </div>

              {/* Suspected Cause & Narrative */}
              <div className="bg-[#111622] p-4 rounded-lg border border-[#171e2c] space-y-2">
                <span className="text-xs font-mono font-semibold text-slate-300 block">
                  Suspected Root Cause
                </span>
                <p className="text-xs font-mono text-[#00E5FF]">
                  {CAUSE_LABELS[incidentDetail.cause] || incidentDetail.cause}
                </p>
                <p className="text-xs text-slate-400 leading-relaxed" data-testid="detail-summary">
                  {incidentDetail.summary || 'Engine sequential state machine logged outlier deviation exceeding decision band.'}
                </p>
              </div>

              {/* Evidence & Cryptographic Verification */}
              <div className="bg-[#111622] p-4 rounded-lg border border-[#171e2c] space-y-3">
                <span className="text-xs font-mono font-semibold text-slate-300 block">
                  Cryptographic Evidence Trail
                </span>

                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex items-center justify-between text-slate-400">
                    <span>Chain Head Hash:</span>
                    <button
                      onClick={() => copyHash(incidentDetail.evidence?.chain_head_hash || '')}
                      data-testid="copy-chain-hash"
                      className="text-[10px] text-[#00E5FF] hover:underline"
                    >
                      {copiedHash ? 'Copied!' : 'Copy'}
                    </button>
                  </div>
                  <div
                    className="p-2 bg-[#0b0e14] rounded border border-[#171e2c] text-[11px] text-slate-300 truncate"
                    title={incidentDetail.evidence?.chain_head_hash}
                    data-testid="chain-hash-display"
                  >
                    {incidentDetail.evidence?.chain_head_hash || 'None recorded'}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 text-xs font-mono pt-2">
                  <div className="p-2 bg-[#0b0e14] rounded border border-[#171e2c]">
                    <span className="text-slate-400 block text-[10px]">Captured Telemetry</span>
                    <span className="text-slate-200 font-semibold">
                      {incidentDetail.evidence?.assessments?.length || 0} samples
                    </span>
                  </div>
                  <div className="p-2 bg-[#0b0e14] rounded border border-[#171e2c]">
                    <span className="text-slate-400 block text-[10px]">Anchor References</span>
                    <span className="text-slate-200 font-semibold">
                      {incidentDetail.evidence?.anchors?.length || 0} anchors
                    </span>
                  </div>
                </div>

                {/* Fault Correlation if exists */}
                {incidentDetail.evidence?.fault && (
                  <div className="p-2.5 bg-[#0b0e14] rounded border border-[#171e2c] text-xs font-mono">
                    <span className="text-slate-400 block text-[10px]">Correlated Fault Injection</span>
                    <span className="text-amber-400 font-semibold capitalize">
                      {incidentDetail.evidence.fault.type.replace('_', ' ')}
                    </span>
                    <span className="text-slate-400 ml-2">
                      ({incidentDetail.evidence.fault.status})
                    </span>
                  </div>
                )}
              </div>

              {/* Transition Audit Timeline */}
              {incidentDetail.timeline && incidentDetail.timeline.length > 0 && (
                <div className="bg-[#111622] p-4 rounded-lg border border-[#171e2c] space-y-3">
                  <span className="text-xs font-mono font-semibold text-slate-300 block">
                    State Machine Transition Audit ({incidentDetail.timeline.length})
                  </span>
                  <div className="space-y-2">
                    {incidentDetail.timeline.map((t, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 bg-[#0b0e14] rounded border border-[#171e2c] flex items-center justify-between text-xs font-mono"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">
                            {new Date(t.at_ms).toLocaleTimeString()}
                          </span>
                          <span className="text-slate-600">&bull;</span>
                          <span className="text-slate-200">
                            {t.from} &rarr; <span className="text-[#00E5FF] font-semibold">{t.to}</span>
                          </span>
                        </div>
                        <span className="text-slate-400 text-[11px]">
                          {t.reasons?.join(', ') || 'CUSUM threshold'}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* View Node link */}
              <div className="pt-2">
                <Link
                  to={`/nodes/${incidentDetail.node_id}`}
                  className="w-full py-2 bg-[#1e2738] hover:bg-[#28354c] text-slate-200 text-xs font-mono rounded-lg transition-colors block text-center"
                >
                  Inspect Node &rarr;
                </Link>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
