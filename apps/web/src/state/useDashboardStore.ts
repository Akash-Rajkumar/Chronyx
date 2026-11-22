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
import {
  CONTRACT_VERSION,
  AssessmentSchema,
  NetworkHealthSchema,
  BaselineStateSchema,
} from '@chronyx/contracts';

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
  assessmentHistory: Record<string, number[]>;

  connectionStatus: ConnectionStatus;
  lastSeenMs: number | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  setSnapshot: (snapshot: Snapshot) => void;
  applyAssessments: (payload: unknown) => void;
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
  assessmentHistory: {} as Record<string, number[]>,
  connectionStatus: 'disconnected' as ConnectionStatus,
  lastSeenMs: null as number | null,
  isLoading: true,
  error: null as string | null,
};

export interface NormalizedAssessmentsPayload {
  assessments: Assessment[];
  network?: NetworkHealth;
  baseline?: BaselineState;
  serverTimeMs?: number;
}

/**
 * Defensively normalizes incoming socket assessments payload.
 * Supports both array-shaped (Assessment[]) and object-shaped payloads
 * ({ assessments?: Assessment[]; network?: NetworkHealth; baseline?: BaselineState; t_ms?: number }).
 * Safely filters out malformed items and returns null for invalid payloads.
 */
export function normalizeAssessmentsPayload(raw: unknown): NormalizedAssessmentsPayload | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }

  // Case 1: Array-shaped payload: Assessment[]
  if (Array.isArray(raw)) {
    const validAssessments: Assessment[] = [];
    for (const item of raw) {
      const parsed = AssessmentSchema.safeParse(item);
      if (parsed.success) {
        validAssessments.push(parsed.data);
      }
    }
    if (validAssessments.length === 0 && raw.length > 0) {
      return null;
    }
    return { assessments: validAssessments };
  }

  // Case 2: Object-shaped payload
  const obj = raw as Record<string, unknown>;
  const validAssessments: Assessment[] = [];
  let foundRecognizedField = false;

  // Extract assessments if present
  if ('assessments' in obj && obj.assessments !== null && obj.assessments !== undefined) {
    foundRecognizedField = true;
    const rawAssessments = obj.assessments;
    if (Array.isArray(rawAssessments)) {
      for (const item of rawAssessments) {
        const parsed = AssessmentSchema.safeParse(item);
        if (parsed.success) {
          validAssessments.push(parsed.data);
        }
      }
    } else if (typeof rawAssessments === 'object') {
      for (const item of Object.values(rawAssessments as Record<string, unknown>)) {
        const parsed = AssessmentSchema.safeParse(item);
        if (parsed.success) {
          validAssessments.push(parsed.data);
        }
      }
    }
  }

  // Extract network if present
  let network: NetworkHealth | undefined = undefined;
  if ('network' in obj && obj.network !== null && obj.network !== undefined) {
    foundRecognizedField = true;
    const parsedNet = NetworkHealthSchema.safeParse(obj.network);
    if (parsedNet.success) {
      network = parsedNet.data;
    }
  }

  // Extract baseline if present
  let baseline: BaselineState | undefined = undefined;
  if ('baseline' in obj && obj.baseline !== null && obj.baseline !== undefined) {
    foundRecognizedField = true;
    const parsedBase = BaselineStateSchema.safeParse(obj.baseline);
    if (parsedBase.success) {
      baseline = parsedBase.data;
    }
  }

  // Extract server time if present
  let serverTimeMs: number | undefined = undefined;
  const rawTime = obj.t_ms ?? obj.server_time_ms;
  if (typeof rawTime === 'number' && Number.isFinite(rawTime) && rawTime > 0) {
    foundRecognizedField = true;
    serverTimeMs = rawTime;
  }

  if (!foundRecognizedField) {
    return null;
  }

  // If assessments was specified as a non-empty array but had zero valid items, and no other valid payload fields were present
  if (
    Array.isArray(obj.assessments) &&
    obj.assessments.length > 0 &&
    validAssessments.length === 0 &&
    network === undefined &&
    baseline === undefined
  ) {
    return null;
  }

  return {
    assessments: validAssessments,
    network,
    baseline,
    serverTimeMs,
  };
}

export const useDashboardStore = create<DashboardState>((set) => ({
  ...initialState,

  setSnapshot: (snapshot: Snapshot) => {
    const assessmentMap: Record<string, Assessment> = {};
    const historyMap: Record<string, number[]> = {};
    const rawAssessments = Array.isArray(snapshot?.assessments) ? snapshot.assessments : [];
    for (const a of rawAssessments) {
      if (a && a.node_id) {
        assessmentMap[a.node_id] = a;
        historyMap[a.node_id] = [a.error_est_ms];
      }
    }
    set({
      contractVersion: snapshot?.contract_version || CONTRACT_VERSION,
      serverTimeMs: snapshot?.server_time_ms || Date.now(),
      nodes: Array.isArray(snapshot?.nodes) ? snapshot.nodes : [],
      assessments: assessmentMap,
      assessmentHistory: historyMap,
      network: snapshot?.network || null,
      anchors: Array.isArray(snapshot?.anchors) ? snapshot.anchors : [],
      faults: Array.isArray(snapshot?.faults) ? snapshot.faults : [],
      baseline: snapshot?.baseline || null,
      config: snapshot?.config || null,
      openIncidents: Array.isArray(snapshot?.open_incidents) ? snapshot.open_incidents : [],
      lastSeenMs: Date.now(),
      isLoading: false,
      error: null,
    });
  },

  applyAssessments: (payload: unknown) => {
    const normalized = normalizeAssessmentsPayload(payload);
    if (!normalized) {
      return;
    }

    set((state) => {
      let nextAssessments = state.assessments;
      let nextHistory = state.assessmentHistory;
      if (normalized.assessments.length > 0) {
        nextAssessments = { ...state.assessments };
        nextHistory = { ...state.assessmentHistory };
        for (const a of normalized.assessments) {
          nextAssessments[a.node_id] = a;
          const current = nextHistory[a.node_id] || [];
          nextHistory[a.node_id] = [...current, a.error_est_ms].slice(-60);
        }
      }

      return {
        assessments: nextAssessments,
        assessmentHistory: nextHistory,
        network: normalized.network !== undefined ? normalized.network : state.network,
        baseline: normalized.baseline !== undefined ? normalized.baseline : state.baseline,
        serverTimeMs: normalized.serverTimeMs !== undefined ? normalized.serverTimeMs : state.serverTimeMs,
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
export const useNodeHistory = (id: string | undefined) =>
  useDashboardStore((s) => (id ? s.assessmentHistory[id] || [] : []));
export const useAnchors = () => useDashboardStore((s) => s.anchors);
export const useFaults = () => useDashboardStore((s) => s.faults);
export const useOpenIncidents = () => useDashboardStore((s) => s.openIncidents);
export const useConnectionStatus = () => useDashboardStore((s) => s.connectionStatus);
export const useRecentTransitions = () => useDashboardStore((s) => s.recentTransitions);
export const useEngineConfig = () => useDashboardStore((s) => s.config);
export const useIsLoading = () => useDashboardStore((s) => s.isLoading);
export const useStoreError = () => useDashboardStore((s) => s.error);
export const useLastSeenMs = () => useDashboardStore((s) => s.lastSeenMs);
