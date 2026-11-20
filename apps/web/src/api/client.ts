// Web API Client Stub reading VITE_API_URL (Part F, P1-T1)
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
} from '@chronyx/contracts';

const API_BASE = import.meta.env['VITE_API_URL'] || 'http://localhost:3001';

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!res.ok) {
    const errorBody = (await res.json().catch(() => ({}))) as {
      error?: { message?: string };
    };
    throw new Error(errorBody.error?.message || `HTTP ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

export const api = {
  getHealth: () =>
    request<{ ok: true; contract_version: string; server_time_ms: number; db: string; anchors_ok: boolean }>(
      '/api/v1/health',
    ),
  getState: () => request<Snapshot>('/api/v1/state'),
  getJoinInfo: () => request<JoinInfo>('/api/v1/join-info'),
  registerNode: (data: { name: string; kind: 'browser'; public_key: string }) =>
    request<{ node: NodeInfo; hub_time_ms: number }>('/api/v1/nodes/register', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  getNodes: () => request<NodeInfo[]>('/api/v1/nodes'),
  getNode: (id: string) => request<{ node: NodeInfo; assessment: Assessment | null }>(`/api/v1/nodes/${id}`),
  getNodeHistory: (id: string, window_s = 300) =>
    request<{ points: HistoryPoint[] }>(`/api/v1/nodes/${id}/history?window_s=${window_s}`),
  sendHeartbeat: (hb: Heartbeat) =>
    request<HeartbeatAck>('/api/v1/heartbeats', {
      method: 'POST',
      body: JSON.stringify(hb),
    }),
  getConfig: () => request<EngineConfig>('/api/v1/config'),
  patchConfig: (patch: Partial<EngineConfig>) =>
    request<EngineConfig>('/api/v1/config', {
      method: 'PATCH',
      body: JSON.stringify(patch),
    }),
  getIncidents: (status = 'all', limit = 50) =>
    request<IncidentSummary[]>(`/api/v1/incidents?status=${status}&limit=${limit}`),
  getIncident: (id: string) => request<Incident>(`/api/v1/incidents/${id}`),
  getObservations: () => request<Observation[]>('/api/v1/observations'),
  getPassport: (id: string) => request<Passport>(`/api/v1/observations/${id}/passport`),
  getFaults: (status = 'all') => request<Fault[]>(`/api/v1/faults?status=${status}`),
  createFault: (spec: FaultSpec) =>
    request<Fault>('/api/v1/faults', {
      method: 'POST',
      body: JSON.stringify(spec),
    }),
  stopFault: (id: string) =>
    request<Fault>(`/api/v1/faults/${id}`, {
      method: 'DELETE',
    }),
  getBaseline: () => request<BaselineState>('/api/v1/baseline'),
  replayScience: (req: ScienceReplayReq) =>
    request<ScienceReplayRes>('/api/v1/science/replay', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  runBenchmark: (req: BenchmarkRunReq) =>
    request<{ run_id: string }>('/api/v1/benchmarks/run', {
      method: 'POST',
      body: JSON.stringify(req),
    }),
  getBenchmarks: () => request<BenchmarkRun[]>('/api/v1/benchmarks'),
  getBenchmark: (id: string) => request<BenchmarkRun>(`/api/v1/benchmarks/${id}`),
  getLiveMetrics: () => request<LiveMetrics>('/api/v1/metrics/live'),
  triggerScenario: (name: string, target_node_id?: string) =>
    request<{ ok: true; faults: Fault[] }>('/api/v1/demo/scenario', {
      method: 'POST',
      body: JSON.stringify({ name, target_node_id }),
    }),
  resetDemo: (hard = false) =>
    request<{ ok: true }>('/api/v1/demo/reset', {
      method: 'POST',
      body: JSON.stringify({ hard }),
    }),
};
