/**
 * Typed REST API client for Chronyx (Part E2b)
 * Uses exact routes and Zod validation from @chronyx/contracts.
 * Strictly decoupled from mock fixtures.
 */
import { ROUTES } from '@chronyx/contracts';
import {
  HealthResponseSchema,
  SnapshotSchema,
  JoinInfoSchema,
  NodeInfoSchema,
  AssessmentSchema,
  HistoryPointSchema,
  HeartbeatAckSchema,
  EngineConfigSchema,
  IncidentSummarySchema,
  IncidentSchema,
  ObservationSchema,
  PassportSchema,
  FaultSchema,
  BaselineStateSchema,
  ScienceReplayResSchema,
  BenchmarkRunSchema,
  LiveMetricsSchema,
  AnchorInfoSchema,
} from '@chronyx/contracts';
import type {
  Snapshot,
  NodeInfo,
  Assessment,
  HistoryPoint,
  HeartbeatAck,
  Heartbeat,
  IncidentSummary,
  Incident,
  Observation,
  Passport,
  Fault,
  FaultSpec,
  BaselineState,
  ScienceReplayReq,
  ScienceReplayRes,
  BenchmarkRun,
  BenchmarkRunReq,
  LiveMetrics,
  EngineConfig,
  JoinInfo,
  AnchorInfo,
  DemoScenarioName,
} from '@chronyx/contracts';
import { z } from 'zod';

const API_BASE = (typeof import.meta !== 'undefined' && import.meta.env?.['VITE_API_URL']) || 'http://localhost:3001';

export class ApiError extends Error {
  code: string;
  details?: unknown;

  constructor(message: string, code = 'INTERNAL', details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, options?: RequestInit, schema?: z.ZodType<T>): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as {
      error?: { message?: string; code?: string; details?: unknown };
    };
    throw new ApiError(
      errorBody.error?.message || `HTTP ${res.status} ${res.statusText}`,
      errorBody.error?.code || 'INTERNAL',
      errorBody.error?.details,
    );
  }

  const json = (await res.json()) as unknown;
  if (schema) {
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      // Safe diagnostics: schema issue paths and messages only, never leak raw payload or secrets
      const safeIssues = parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      }));
      const summary = safeIssues.map((i) => `${i.path || '(root)'}: ${i.message}`).join('; ');
      throw new ApiError(
        `Response validation failed for ${path}: ${summary}`,
        'BAD_REQUEST',
        safeIssues,
      );
    }
    return parsed.data;
  }

  return json as T;
}

export const api = {
  getHealth: async () => {
    return request<{ ok: true; contract_version: string; server_time_ms: number; db: string; anchors_ok: boolean }>(
      ROUTES.HEALTH,
      undefined,
      HealthResponseSchema,
    );
  },

  getState: async (): Promise<Snapshot> => {
    return request<Snapshot>(ROUTES.STATE, undefined, SnapshotSchema);
  },

  getJoinInfo: async (): Promise<JoinInfo> => {
    return request<JoinInfo>(ROUTES.JOIN_INFO, undefined, JoinInfoSchema);
  },

  registerNode: async (data: { name: string; kind: 'browser'; public_key: string }) => {
    return request<{ node: NodeInfo; hub_time_ms: number }>(ROUTES.NODES_REGISTER, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  getNodes: async (): Promise<NodeInfo[]> => {
    return request<NodeInfo[]>(ROUTES.NODES, undefined, z.array(NodeInfoSchema));
  },

  getNode: async (id: string): Promise<{ node: NodeInfo; assessment: Assessment | null }> => {
    return request<{ node: NodeInfo; assessment: Assessment | null }>(
      ROUTES.NODE_BY_ID(id),
      undefined,
      z.object({ node: NodeInfoSchema, assessment: AssessmentSchema.nullable() }),
    );
  },

  getNodeHistory: async (id: string, window_s = 300): Promise<{ points: HistoryPoint[] }> => {
    return request<{ points: HistoryPoint[] }>(
      `${ROUTES.NODE_HISTORY(id)}?window_s=${window_s}`,
      undefined,
      z.object({ points: z.array(HistoryPointSchema) }),
    );
  },

  sendHeartbeat: async (hb: Heartbeat): Promise<HeartbeatAck> => {
    return request<HeartbeatAck>(
      ROUTES.HEARTBEATS,
      {
        method: 'POST',
        body: JSON.stringify(hb),
      },
      HeartbeatAckSchema,
    );
  },

  getConfig: async (): Promise<EngineConfig> => {
    return request<EngineConfig>(ROUTES.CONFIG, undefined, EngineConfigSchema);
  },

  patchConfig: async (patch: Partial<EngineConfig>): Promise<EngineConfig> => {
    return request<EngineConfig>(
      ROUTES.CONFIG,
      {
        method: 'PATCH',
        body: JSON.stringify(patch),
      },
      EngineConfigSchema,
    );
  },

  getAnchors: async (): Promise<AnchorInfo[]> => {
    return request<AnchorInfo[]>(ROUTES.ANCHORS, undefined, z.array(AnchorInfoSchema));
  },

  getIncidents: async (status = 'all', limit = 50): Promise<IncidentSummary[]> => {
    return request<IncidentSummary[]>(
      `${ROUTES.INCIDENTS}?status=${status}&limit=${limit}`,
      undefined,
      z.array(IncidentSummarySchema),
    );
  },

  getIncident: async (id: string): Promise<Incident> => {
    return request<Incident>(ROUTES.INCIDENT_BY_ID(id), undefined, IncidentSchema);
  },

  getObservations: async (): Promise<Observation[]> => {
    return request<Observation[]>(ROUTES.OBSERVATIONS, undefined, z.array(ObservationSchema));
  },

  getPassport: async (id: string): Promise<Passport> => {
    return request<Passport>(ROUTES.OBSERVATION_PASSPORT(id), undefined, PassportSchema);
  },

  getFaults: async (status = 'all'): Promise<Fault[]> => {
    return request<Fault[]>(`${ROUTES.FAULTS}?status=${status}`, undefined, z.array(FaultSchema));
  },

  createFault: async (spec: FaultSpec): Promise<Fault> => {
    return request<Fault>(
      ROUTES.FAULTS,
      {
        method: 'POST',
        body: JSON.stringify(spec),
      },
      FaultSchema,
    );
  },

  stopFault: async (id: string): Promise<Fault> => {
    return request<Fault>(
      ROUTES.FAULT_BY_ID(id),
      {
        method: 'DELETE',
      },
      FaultSchema,
    );
  },

  getBaseline: async (): Promise<BaselineState> => {
    return request<BaselineState>(ROUTES.BASELINE, undefined, BaselineStateSchema);
  },

  replayScience: async (req: ScienceReplayReq): Promise<ScienceReplayRes> => {
    return request<ScienceReplayRes>(
      ROUTES.SCIENCE_REPLAY,
      {
        method: 'POST',
        body: JSON.stringify(req),
      },
      ScienceReplayResSchema,
    );
  },

  runBenchmark: async (req: BenchmarkRunReq): Promise<{ run_id: string }> => {
    return request<{ run_id: string }>(ROUTES.BENCHMARKS_RUN, {
      method: 'POST',
      body: JSON.stringify(req),
    });
  },

  getBenchmarks: async (): Promise<BenchmarkRun[]> => {
    return request<BenchmarkRun[]>(ROUTES.BENCHMARKS, undefined, z.array(BenchmarkRunSchema));
  },

  getBenchmark: async (id: string): Promise<BenchmarkRun> => {
    return request<BenchmarkRun>(ROUTES.BENCHMARK_BY_ID(id), undefined, BenchmarkRunSchema);
  },

  getLiveMetrics: async (): Promise<LiveMetrics> => {
    return request<LiveMetrics>(ROUTES.METRICS_LIVE, undefined, LiveMetricsSchema);
  },

  triggerScenario: async (name: DemoScenarioName, target_node_id?: string): Promise<{ ok: boolean }> => {
    const body: Record<string, unknown> = { name };
    if (target_node_id !== undefined) {
      body['target_node_id'] = target_node_id;
    }
    return request<{ ok: boolean }>(ROUTES.DEMO_SCENARIO, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

  resetDemo: async (hard?: boolean): Promise<{ ok: boolean }> => {
    const body: Record<string, unknown> = {};
    if (hard !== undefined) {
      body['hard'] = hard;
    }
    return request<{ ok: boolean }>(ROUTES.DEMO_RESET, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },
};
