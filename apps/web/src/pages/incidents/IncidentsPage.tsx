import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import type { Incident, IncidentSummary } from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import { useConnectionStatus, useOpenIncidents } from '../../state/useDashboardStore.js';
import { Button } from '../../ui/Button.js';

function formatUtc(ms: number): string {
  return new Date(ms).toISOString().slice(11, 19);
}

/**
 * Incidents Page (Part G4.7)
 * Owned by Person 3 (P3-T5)
 */
export function IncidentsPage() {
  const { id: routeIncidentId } = useParams<{ id: string }>();

  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const storeIncidents = useOpenIncidents();
  const connectionStatus = useConnectionStatus();

  const [fetchedIncidents, setFetchedIncidents] = useState<IncidentSummary[] | null>(null);
  const [selectedIncident, setSelectedIncident] = useState<Incident | null>(null);
  const [loadingList, setLoadingList] = useState<boolean>(false);
  const [listError, setListError] = useState<string | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadIncidents = useCallback(async () => {
    setLoadingList(true);
    setListError(null);
    try {
      const list = await api.getIncidents('all', 50);
      setFetchedIncidents(list);
    } catch (err) {
      setListError(err instanceof Error ? err.message : 'Unable to fetch incident history');
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void loadIncidents();
  }, [loadIncidents, storeIncidents.length]);

  useEffect(() => {
    if (!routeIncidentId) {
      setSelectedIncident(null);
      return;
    }
    let active = true;
    setDetailError(null);
    api
      .getIncident(routeIncidentId)
      .then((inc) => {
        if (active) setSelectedIncident(inc);
      })
      .catch((err) => {
        if (active) {
          setDetailError(err instanceof Error ? err.message : 'Unable to load incident detail');
        }
      });
    return () => {
      active = false;
    };
  }, [routeIncidentId]);

  // Merge fetched list with live open incidents from store
  const incidents: IncidentSummary[] = (() => {
    const byId = new Map<string, IncidentSummary>();
    for (const inc of fetchedIncidents ?? []) {
      byId.set(inc.id, inc);
    }
    for (const inc of storeIncidents) {
      byId.set(inc.id, inc);
    }
    return Array.from(byId.values()).sort((a, b) => b.opened_at_ms - a.opened_at_ms);
  })();

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">Incident Log</h2>
            {connectionStatus === 'mock' && (
              <span className="text-[11px] font-mono px-2 py-0.5 rounded-[6px] bg-amber-500/12 border border-amber-400/30 text-amber-200">
                SIMULATED (MOCK)
              </span>
            )}
          </div>
          <p className="text-sm text-muted">
            Timing anomalies, quarantine lifecycle, and cryptographic audit trails
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          loading={loadingList}
          onClick={() => void loadIncidents()}
        >
          Refresh
        </Button>
      </div>

      {listError && (
        <div className="mc-well border-amber-400/30 border-l-2 border-l-trust-suspect rounded-[10px] px-4 py-3 text-xs text-amber-100 flex items-center justify-between gap-3">
          <span>{listError}</span>
          <button
            type="button"
            onClick={() => void loadIncidents()}
            className="underline font-medium"
          >
            Retry
          </button>
        </div>
      )}

      {selectedIncident && (
        <div className="mc-panel-primary mc-ticks rounded-[14px] p-5 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
            <div>
              <span className="font-mono text-[11px] text-accent-cyan block">
                Incident {selectedIncident.id.slice(0, 8)}
              </span>
              <h3 className="text-base font-semibold text-foreground">
                {selectedIncident.node_name} · {selectedIncident.cause}
              </h3>
              <p className="text-xs text-muted mt-0.5">{selectedIncident.summary}</p>
            </div>
            <Link
              to="/incidents"
              className="text-xs text-accent-cyan hover:underline font-medium"
            >
              Close detail
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono tabular-nums">
            <div className="mc-well rounded-[10px] p-3">
              <span className="text-[10px] text-muted block font-sans">Peak Error</span>
              <span className="text-sm font-semibold text-trust-quarantined">
                {selectedIncident.peak_error_ms.toFixed(2)} ms
              </span>
            </div>
            <div className="mc-well rounded-[10px] p-3">
              <span className="text-[10px] text-muted block font-sans">Detection Latency</span>
              <span className="text-sm font-semibold text-foreground">
                {selectedIncident.detection_latency_s !== null
                  ? `${selectedIncident.detection_latency_s.toFixed(1)} s`
                  : '--'}
              </span>
            </div>
            <div className="mc-well rounded-[10px] p-3">
              <span className="text-[10px] text-muted block font-sans">Chain Head</span>
              <span className="text-xs text-foreground truncate block">
                {selectedIncident.evidence.chain_head_hash.slice(0, 16)}...
              </span>
            </div>
          </div>
        </div>
      )}

      {detailError && (
        <div className="mc-well border-rose-400/30 border-l-2 border-l-trust-quarantined rounded-[10px] px-4 py-3 text-xs text-rose-100">
          {detailError}
        </div>
      )}

      <div className="mc-panel rounded-[14px] p-5">
        {incidents.length === 0 ? (
          <div data-testid="incident-row" className="mc-well rounded-[10px] p-6 text-center text-xs text-muted">
            No open incidents recorded.
          </div>
        ) : (
          <div className="overflow-x-auto mc-well rounded-[10px]">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-white/[0.08] text-[11px] font-mono text-muted">
                  <th className="py-2.5 pl-4 pr-4 font-medium">Node</th>
                  <th className="py-2.5 pr-4 font-medium">Status</th>
                  <th className="py-2.5 pr-4 font-medium">Cause</th>
                  <th className="py-2.5 pr-4 font-medium">Opened (UTC)</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Peak Error</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Detect Latency</th>
                  <th className="py-2.5 pr-4 font-medium text-right">Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.06]">
                {incidents.map((inc) => (
                  <tr
                    key={inc.id}
                    data-testid="incident-row"
                    className="hover:bg-white/[0.03] transition-colors"
                  >
                    <td className="py-3 pl-4 pr-4 font-medium text-foreground">{inc.node_name}</td>
                    <td className="py-3 pr-4">
                      <span
                        className={`inline-flex px-2 py-0.5 rounded-[6px] font-mono text-[11px] border ${
                          inc.status === 'open'
                            ? 'bg-trust-quarantined/15 text-trust-quarantined border-trust-quarantined/35'
                            : 'bg-trust-trusted/12 text-trust-trusted border-trust-trusted/30'
                        }`}
                      >
                        {inc.status}
                      </span>
                    </td>
                    <td className="py-3 pr-4 font-mono text-muted">{inc.cause}</td>
                    <td className="py-3 pr-4 font-mono text-muted tabular-nums">
                      {formatUtc(inc.opened_at_ms)}
                    </td>
                    <td className="py-3 pr-4 font-mono text-right text-foreground tabular-nums">
                      {inc.peak_error_ms.toFixed(2)} ms
                    </td>
                    <td className="py-3 pr-4 font-mono text-right text-muted tabular-nums">
                      {inc.detection_latency_s !== null
                        ? `${inc.detection_latency_s.toFixed(1)} s`
                        : '--'}
                    </td>
                    <td className="py-3 pr-4 text-right">
                      <Link
                        to={`/incidents/${inc.id}`}
                        className="text-accent-cyan hover:underline font-medium"
                      >
                        Inspect
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
