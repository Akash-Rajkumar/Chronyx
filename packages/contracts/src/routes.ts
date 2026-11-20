// Frozen REST route paths (Part E2b)
// All routes prefixed with /api/v1

export const ROUTES = {
  HEALTH: '/api/v1/health',
  STATE: '/api/v1/state',
  JOIN_INFO: '/api/v1/join-info',
  NODES_REGISTER: '/api/v1/nodes/register',
  NODES: '/api/v1/nodes',
  NODE_BY_ID: (id: string) => `/api/v1/nodes/${id}`,
  NODE_HISTORY: (id: string) => `/api/v1/nodes/${id}/history`,
  NODE_EVIDENCE_BUNDLE: (id: string) => `/api/v1/nodes/${id}/evidence-bundle`,
  HEARTBEATS: '/api/v1/heartbeats',
  CONFIG: '/api/v1/config',
  ANCHORS: '/api/v1/anchors',
  INCIDENTS: '/api/v1/incidents',
  INCIDENT_BY_ID: (id: string) => `/api/v1/incidents/${id}`,
  INCIDENT_EXPORT: (id: string) => `/api/v1/incidents/${id}/export`,
  OBSERVATIONS: '/api/v1/observations',
  OBSERVATION_PASSPORT: (id: string) => `/api/v1/observations/${id}/passport`,
  FAULTS: '/api/v1/faults',
  FAULT_BY_ID: (id: string) => `/api/v1/faults/${id}`,
  BASELINE: '/api/v1/baseline',
  SCIENCE_REPLAY: '/api/v1/science/replay',
  BENCHMARKS_RUN: '/api/v1/benchmarks/run',
  BENCHMARKS: '/api/v1/benchmarks',
  BENCHMARK_BY_ID: (id: string) => `/api/v1/benchmarks/${id}`,
  METRICS_LIVE: '/api/v1/metrics/live',
  DEMO_SCENARIO: '/api/v1/demo/scenario',
  DEMO_RESET: '/api/v1/demo/reset',
} as const;

