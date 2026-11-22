import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Fault, NodeInfo, UUID } from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { initDashboardSocket } from '../../api/socket.js';
import {
  useAnchors,
  useAssessments,
  useDashboardStore,
  useFaults,
  useIsLoading,
  useNetworkHealth,
  useNodes,
  useStoreError,
} from '../../state/useDashboardStore.js';
import {
  CHRONYX_GLOBE_THEME,
  CHRONYX_HUB,
  RouteGlobe,
  type Place,
} from '../../components/ui/route-globe.js';
import { FloatingJoinCard } from './FloatingJoinCard.js';
import { NodeInspectorPanel } from './NodeInspectorPanel.js';

/**
 * Deterministic, well-separated abstract global topology vantage coordinates.
 * Used solely for visual network topology layout when nodes do not provide
 * physical geolocation coordinates.
 */
const TOPOLOGY_SLOTS: ReadonlyArray<{ lon: number; lat: number }> = [
  { lon: -4.0, lat: 46.0 },    // Western Europe sector
  { lon: 55.0, lat: 24.0 },    // Arabian sector
  { lon: 78.0, lat: 14.0 },    // South Asia sector
  { lon: 18.0, lat: -22.0 },   // Southern Africa sector
  { lon: -70.0, lat: -24.0 },  // Andean sector
  { lon: -105.0, lat: 36.0 },  // North America sector
  { lon: 118.0, lat: 32.0 },   // East Asia sector
  { lon: 144.0, lat: -28.0 },  // Oceania sector
  { lon: 34.0, lat: 56.0 },    // Northern Eurasia sector
  { lon: -45.0, lat: -12.0 },  // Atlantic South sector
  { lon: 102.0, lat: 6.0 },    // Maritime SE sector
  { lon: -155.0, lat: 20.0 },  // Central Pacific sector
];

function hashString(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Assigns stable, collision-free deterministic topology coordinates for nodes
 * that do not carry physical coordinates.
 */
function assignTopologyCoords(
  nodes: readonly NodeInfo[],
): Map<UUID, { lon: number; lat: number }> {
  const result = new Map<UUID, { lon: number; lat: number }>();
  const usedSlots = new Set<number>();

  // Sort by ID for deterministic slot assignment regardless of array order
  const ordered = [...nodes].sort((a, b) => a.id.localeCompare(b.id));

  for (let idx = 0; idx < ordered.length; idx++) {
    const node = ordered[idx]!;
    const raw = node as NodeInfo & { lon?: unknown; lat?: unknown };
    if (
      typeof raw.lon === 'number' &&
      Number.isFinite(raw.lon) &&
      typeof raw.lat === 'number' &&
      Number.isFinite(raw.lat)
    ) {
      result.set(node.id, { lon: raw.lon, lat: raw.lat });
      continue;
    }

    // First fill curated visible slots in deterministic order so initial nodes are well-spread on the front hemisphere
    let slot = idx < TOPOLOGY_SLOTS.length ? idx : hashString(node.id) % TOPOLOGY_SLOTS.length;
    if (usedSlots.has(slot) && usedSlots.size < TOPOLOGY_SLOTS.length) {
      for (let probe = 0; probe < TOPOLOGY_SLOTS.length; probe++) {
        const candidate = (slot + probe) % TOPOLOGY_SLOTS.length;
        if (!usedSlots.has(candidate)) {
          slot = candidate;
          break;
        }
      }
    }

    if (!usedSlots.has(slot)) {
      usedSlots.add(slot);
      result.set(node.id, TOPOLOGY_SLOTS[slot]!);
    } else {
      // Deterministic golden-ratio fallback if > 12 nodes
      const h = hashString(node.id);
      const lon = ((h % 3600) / 10) - 180;
      const lat = (((h >>> 12) % 1200) / 10) - 60;
      result.set(node.id, { lon, lat });
    }
  }

  return result;
}

export const ObservatoryPage: React.FC = () => {
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  const nodesHook = useNodes();
  const assessmentsHook = useAssessments();
  const storeFaultsHook = useFaults();
  const networkHook = useNetworkHealth();
  const anchorsHook = useAnchors();
  const isLoadingHook = useIsLoading();
  const storeErrorHook = useStoreError();

  const isClient = typeof window !== 'undefined';
  const snap = isClient ? null : useDashboardStore.getState();

  const nodes = isClient ? nodesHook : snap!.nodes;
  const assessments = isClient ? assessmentsHook : snap!.assessments;
  const storeFaults = isClient ? storeFaultsHook : snap!.faults;
  const network = isClient ? networkHook : snap!.network;
  const anchors = isClient ? anchorsHook : snap!.anchors;
  const isLoading = isClient ? isLoadingHook : snap!.isLoading;
  const storeError = isClient ? storeErrorHook : snap!.error;

  const [fetchedFaults, setFetchedFaults] = useState<Fault[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState<UUID | null>(null);
  const [focusTarget, setFocusTarget] = useState<{
    lon: number;
    lat: number;
    seq: number;
  } | null>(null);

  // Fetch active faults once on mount; real-time updates arrive over Socket.IO
  useEffect(() => {
    let active = true;
    api
      .getFaults('active')
      .then((list) => {
        if (active) setFetchedFaults(list);
      })
      .catch(() => {
        // Store snapshot / Socket.IO faults still populate state
      });
    return () => {
      active = false;
    };
  }, []);

  const activeFaults = useMemo(() => {
    const byId = new Map<string, Fault>();
    for (const f of fetchedFaults) byId.set(f.id, f);
    for (const f of storeFaults) byId.set(f.id, f);
    return Array.from(byId.values()).filter((f) => f.status === 'active');
  }, [fetchedFaults, storeFaults]);

  const activeFaultsByNode = useMemo(() => {
    const map = new Map<UUID, Fault[]>();
    for (const f of activeFaults) {
      const list = map.get(f.node_id) ?? [];
      list.push(f);
      map.set(f.node_id, list);
    }
    return map;
  }, [activeFaults]);

  const coordsMap = useMemo(() => assignTopologyCoords(nodes), [nodes]);

  const globePlaces: Place[] = useMemo(() => {
    return nodes.map((node) => {
      const coords = coordsMap.get(node.id) ?? { lon: 0, lat: 20 };
      const assessment = assessments[node.id];
      const nodeFaults = activeFaultsByNode.get(node.id) ?? [];
      const trustState = assessment?.state ?? 'unassessed';

      return {
        id: node.id,
        name: node.name,
        lon: coords.lon,
        lat: coords.lat,
        kind: node.kind,
        online: node.online,
        trustState,
        hasActiveFault: nodeFaults.length > 0,
        activeFaultType: nodeFaults[0]?.type,
        errorEstMs: assessment ? assessment.error_est_ms : null,
        confidence:
          assessment && typeof assessment.confidence === 'number'
            ? assessment.confidence
            : null,
      };
    });
  }, [nodes, coordsMap, assessments, activeFaultsByNode]);

  const selectedNode = useMemo(
    () => (selectedNodeId ? nodes.find((n) => n.id === selectedNodeId) ?? null : null),
    [nodes, selectedNodeId],
  );

  const handleSelectPlace = useCallback((place: Place) => {
    setSelectedNodeId(place.id);
    setFocusTarget((prev) => ({
      lon: place.lon,
      lat: place.lat,
      seq: (prev?.seq ?? 0) + 1,
    }));
  }, []);

  const handleFaultChanged = useCallback((fault: Fault) => {
    setFetchedFaults((prev) => [fault, ...prev.filter((f) => f.id !== fault.id)]);
  }, []);

  const anchorsOk =
    network?.anchor_ok ?? (anchors.length > 0 ? anchors.every((a) => a.ok) : false);

  const quarantinedCount =
    network?.quarantined ??
    globePlaces.filter((p) => p.online && p.trustState === 'quarantined').length;
  const suspectCount =
    network?.suspect ??
    globePlaces.filter((p) => p.online && p.trustState === 'suspect').length;
  const trustedCount =
    network?.trusted ??
    globePlaces.filter((p) => p.online && p.trustState === 'trusted').length;

  return (
    <div
      data-testid="global-observatory-page"
      className="relative h-full w-full overflow-hidden bg-[#06080d] text-white"
    >
      {/* Full-Viewport Interactive 3D Route Globe */}
      <RouteGlobe
        hub={CHRONYX_HUB}
        places={globePlaces}
        selectedId={selectedNodeId}
        focusTarget={focusTarget}
        onSelectPlace={handleSelectPlace}
        theme={CHRONYX_GLOBE_THEME}
        className="!absolute inset-0"
      />

      {/* Upper-Right Floating Join as a Node Window */}
      <FloatingJoinCard />

      {/* Selected Node Floating Inspector & Fault Injection Panel */}
      {selectedNode && (
        <NodeInspectorPanel
          node={selectedNode}
          assessment={assessments[selectedNode.id]}
          activeFaults={activeFaultsByNode.get(selectedNode.id) ?? []}
          onClose={() => setSelectedNodeId(null)}
          onFaultChanged={handleFaultChanged}
        />
      )}

      {/* Subtle Loading / Error / Empty Overlays (Never block globe if nodes exist) */}
      {isLoading && nodes.length === 0 && (
        <div className="pointer-events-none fixed inset-0 z-10 flex items-center justify-center">
          <div className="liquid-glass rounded-full bg-[#070b15]/85 px-5 py-2.5 flex items-center gap-3 text-xs font-mono text-white/85">
            <span className="h-3 w-3 rounded-full border-2 border-accent-cyan/30 border-t-accent-cyan animate-spin" />
            <span>Connecting to Chronyx Observatory…</span>
          </div>
        </div>
      )}

      {!isLoading && storeError && nodes.length === 0 && (
        <div className="fixed inset-0 z-10 flex items-center justify-center pointer-events-none px-4">
          <div className="pointer-events-auto liquid-glass rounded-2xl bg-[#070b15]/90 p-5 max-w-sm text-center space-y-2 border border-red-500/30">
            <h2 className="text-sm font-semibold text-white">Observatory Telemetry Offline</h2>
            <p className="text-xs text-white/65">{storeError}</p>
          </div>
        </div>
      )}

      {!isLoading && !storeError && nodes.length === 0 && (
        <div className="fixed inset-0 z-10 flex items-center justify-center pointer-events-none px-4">
          <div className="pointer-events-auto liquid-glass rounded-2xl bg-[#070b15]/88 p-5 max-w-sm text-center space-y-3">
            <h2 className="text-sm font-semibold text-white">No Observatory Nodes Online</h2>
            <p className="text-xs text-white/65">
              Use the Join as a Node window in the upper-right or join this browser to add a live timing node.
            </p>
            <Link
              to="/join"
              className="inline-flex items-center px-4 py-2 rounded-full text-xs font-semibold bg-white text-black hover:bg-accent-cyan transition-colors"
            >
              Join as a Timing Node →
            </Link>
          </div>
        </div>
      )}

      {/* Bottom Floating Observatory Telemetry & Node Quick-Select Bar */}
      <div className="pointer-events-none fixed bottom-3 left-3 right-3 sm:bottom-5 sm:left-5 sm:right-5 z-20 flex flex-col sm:flex-row items-start sm:items-end justify-between gap-3">
        {/* Compact Network Summary + Topology Disclaimer */}
        <div
          className={`pointer-events-auto liquid-glass rounded-2xl bg-[#070b15]/78 px-4 py-2.5 max-w-full ${
            selectedNode ? 'hidden sm:block sm:ml-[372px]' : ''
          }`}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs font-mono">
            <div className="flex items-center gap-1.5">
              <span className="text-white/50 text-[10px] uppercase tracking-wider">Health</span>
              <span className="text-accent-cyan font-semibold tabular-nums">
                {network ? `${network.score}%` : '--'}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-cyan-400" />
              <span className="text-white/85 tabular-nums">{trustedCount} Trusted</span>
            </div>
            {suspectCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-400" />
                <span className="text-amber-300 tabular-nums">{suspectCount} Suspect</span>
              </div>
            )}
            {quarantinedCount > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-red-500 shadow-[0_0_8px_#ff4d4f]" />
                <span className="text-red-300 font-semibold tabular-nums">
                  {quarantinedCount} Quarantined
                </span>
              </div>
            )}
            <span className="text-[10px] text-white/45 hidden md:inline">
              {anchorsOk ? 'NTP Anchors Verified' : 'NTP Anchors Unavailable'}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-white/45 font-mono">
            Abstract global topology (logical layout, not physical geolocation) · Click any node to inspect · Drag globe to rotate
          </p>
        </div>

        {/* Clickable Node Roster Pills (Lets user focus any node even if currently on back hemisphere) */}
        {globePlaces.length > 0 && (
          <div
            className={`pointer-events-auto flex flex-wrap items-center justify-end gap-1.5 max-w-full sm:max-w-[460px] ${
              selectedNode ? 'hidden lg:flex' : 'flex'
            }`}
          >
            {globePlaces.map((p) => {
              const isSelected = selectedNodeId === p.id;
              const isQuarantined = p.online && p.trustState === 'quarantined';
              const isSuspect = p.online && p.trustState === 'suspect';
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => handleSelectPlace(p)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono border backdrop-blur-md transition-all cursor-pointer ${
                    isQuarantined
                      ? 'bg-red-950/85 border-red-500/70 text-red-200 shadow-[0_0_12px_rgba(255,77,79,0.35)]'
                      : isSuspect
                        ? 'bg-amber-950/80 border-amber-400/60 text-amber-200'
                        : !p.online
                          ? 'bg-slate-900/75 border-slate-600/40 text-slate-400'
                          : 'bg-[#070b15]/80 border-white/15 text-white/85 hover:border-accent-cyan/60'
                  } ${isSelected ? 'ring-2 ring-white/80' : ''}`}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${
                      isQuarantined
                        ? 'bg-red-500'
                        : isSuspect
                          ? 'bg-amber-400'
                          : !p.online
                            ? 'bg-slate-400'
                            : 'bg-cyan-400'
                    }`}
                  />
                  <span>{p.name}</span>
                  {p.hasActiveFault && !isQuarantined && (
                    <span className="text-[9px] text-amber-300 font-bold">!</span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
