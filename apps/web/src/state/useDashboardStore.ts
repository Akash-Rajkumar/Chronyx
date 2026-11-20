import { create } from 'zustand';
import type {
  Snapshot,
  NodeInfo,
  Assessment,
  Transition,
  NetworkHealth,
  AnchorInfo,
  Fault,
  BaselineState,
  EngineConfig,
  IncidentSummary,
} from '@chronyx/contracts';
import { CONTRACT_VERSION } from '@chronyx/contracts';

export type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error' | 'mock';

export interface DashboardState {
  contractVersion: string;
  serverTimeMs: number;
  nodes: NodeInfo[];
  assessments: Record<string, Assessment>;
  network: NetworkHealth | null;
  anchors: AnchorInfo[];
  faults: Fault[];
  baseline: BaselineState | null;
  config: EngineConfig | null;
  openIncidents: IncidentSummary[];
  recentTransitions: Transition[];

  connectionStatus: ConnectionStatus;
  lastSeenMs: number | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setSnapshot: (snapshot: Snapshot) => void;
  applyAssessments: (assessments: Assessment[]) => void;
  applyTransition: (transition: Transition) => void;
  applyIncidentOpened: (incident: IncidentSummary) => void;
  applyIncidentUpdated: (incident: IncidentSummary) => void;
  applyFaultChanged: (fault: Fault) => void;
  applyNodeUpdated: (node: NodeInfo) => void;
  applyAnchors: (anchors: AnchorInfo[]) => void;
  setConnectionStatus: (status: ConnectionStatus) => void;
  setError: (error: string | null) => void;
  setLoading: (isLoading: boolean) => void;
  reset: () => void;
}

const initialState = {
  contractVersion: CONTRACT_VERSION,
  serverTimeMs: 0,
  nodes: [] as NodeInfo[],
  assessments: {} as Record<string, Assessment>,
  network: null as NetworkHealth | null,
  anchors: [] as AnchorInfo[],
  faults: [] as Fault[],
  baseline: null as BaselineState | null,
  config: null as EngineConfig | null,
  openIncidents: [] as IncidentSummary[],
  recentTransitions: [] as Transition[],
  connectionStatus: 'disconnected' as ConnectionStatus,
  lastSeenMs: null as number | null,
  isLoading: true,
  error: null as string | null,
};

export const useDashboardStore = create<DashboardState>((set) => ({
  ...initialState,

  setSnapshot: (snapshot: Snapshot) => {
    const assessmentMap: Record<string, Assessment> = {};
    for (const a of snapshot.assessments) {
      assessmentMap[a.node_id] = a;
    }
    set({
      contractVersion: snapshot.contract_version,
      serverTimeMs: snapshot.server_time_ms,
      nodes: snapshot.nodes,
      assessments: assessmentMap,
      network: snapshot.network,
      anchors: snapshot.anchors,
      faults: snapshot.faults,
      baseline: snapshot.baseline,
      config: snapshot.config,
      openIncidents: snapshot.open_incidents,
      lastSeenMs: Date.now(),
      isLoading: false,
      error: null,
    });
  },

  applyAssessments: (assessments: Assessment[]) => {
    set((state) => {
      const nextMap = { ...state.assessments };
      for (const a of assessments) {
        nextMap[a.node_id] = a;
      }
      return {
        assessments: nextMap,
        lastSeenMs: Date.now(),
      };
    });
  },

  applyTransition: (transition: Transition) => {
    set((state) => ({
      recentTransitions: [transition, ...state.recentTransitions].slice(0, 50),
      lastSeenMs: Date.now(),
    }));
  },

  applyIncidentOpened: (incident: IncidentSummary) => {
    set((state) => {
      const exists = state.openIncidents.some((i) => i.id === incident.id);
      if (exists) return state;
      return {
        openIncidents: [incident, ...state.openIncidents],
        lastSeenMs: Date.now(),
      };
    });
  },

  applyIncidentUpdated: (incident: IncidentSummary) => {
    set((state) => {
      if (incident.status === 'closed') {
        return {
          openIncidents: state.openIncidents.filter((i) => i.id !== incident.id),
          lastSeenMs: Date.now(),
        };
      }
      return {
        openIncidents: state.openIncidents.map((i) => (i.id === incident.id ? incident : i)),
        lastSeenMs: Date.now(),
      };
    });
  },

  applyFaultChanged: (fault: Fault) => {
    set((state) => {
      const idx = state.faults.findIndex((f) => f.id === fault.id);
      if (idx === -1) {
        return {
          faults: [...state.faults, fault],
          lastSeenMs: Date.now(),
        };
      }
      const updated = [...state.faults];
      updated[idx] = fault;
      return {
        faults: updated,
        lastSeenMs: Date.now(),
      };
    });
  },

  applyNodeUpdated: (node: NodeInfo) => {
    set((state) => {
      const idx = state.nodes.findIndex((n) => n.id === node.id);
      if (idx === -1) {
        return {
          nodes: [...state.nodes, node],
          lastSeenMs: Date.now(),
        };
      }
      const updated = [...state.nodes];
      updated[idx] = node;
      return {
        nodes: updated,
        lastSeenMs: Date.now(),
      };
    });
  },

  applyAnchors: (anchors: AnchorInfo[]) => {
    set({
      anchors,
      lastSeenMs: Date.now(),
    });
  },

  setConnectionStatus: (status: ConnectionStatus) => {
    set({ connectionStatus: status });
  },

  setError: (error: string | null) => {
    set({ error, isLoading: false });
  },

  setLoading: (isLoading: boolean) => {
    set({ isLoading });
  },

  reset: () => {
    set(initialState);
  },
}));

// Selector hooks for granular reactivity (prevents re-rendering everything at 1 Hz)
export const useNetworkHealth = () => useDashboardStore((s) => s.network);
export const useNodes = () => useDashboardStore((s) => s.nodes);
export const useNode = (id: string | undefined) =>
  useDashboardStore((s) => (id ? s.nodes.find((n) => n.id === id) : undefined));
export const useAssessment = (id: string | undefined) =>
  useDashboardStore((s) => (id ? s.assessments[id] : undefined));
export const useAssessments = () => useDashboardStore((s) => s.assessments);
export const useAnchors = () => useDashboardStore((s) => s.anchors);
export const useFaults = () => useDashboardStore((s) => s.faults);
export const useOpenIncidents = () => useDashboardStore((s) => s.openIncidents);
export const useConnectionStatus = () => useDashboardStore((s) => s.connectionStatus);
export const useRecentTransitions = () => useDashboardStore((s) => s.recentTransitions);
export const useEngineConfig = () => useDashboardStore((s) => s.config);
export const useIsLoading = () => useDashboardStore((s) => s.isLoading);
export const useStoreError = () => useDashboardStore((s) => s.error);
export const useLastSeenMs = () => useDashboardStore((s) => s.lastSeenMs);
