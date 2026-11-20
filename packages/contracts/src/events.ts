// Frozen Socket.IO event names and signatures (Part E2c)

export const SOCKET_EVENTS = {
  // Client (Node) -> Server
  NODE_JOIN: 'node:join',
  TIME_PING: 'time:ping',
  HEARTBEAT: 'heartbeat',
  FAULT_ACK: 'fault:ack',

  // Client (Dashboard) -> Server
  DASHBOARD_SUBSCRIBE: 'dashboard:subscribe',

  // Server -> Node
  FAULT_APPLY: 'fault:apply',
  FAULT_CLEAR: 'fault:clear',

  // Server -> Dashboards
  SNAPSHOT: 'snapshot',
  ASSESSMENTS: 'assessments',
  TRANSITION: 'transition',
  INCIDENT_OPENED: 'incident:opened',
  INCIDENT_UPDATED: 'incident:updated',
  FAULT_CHANGED: 'fault:changed',
  NODE_UPDATED: 'node:updated',
  ANCHORS: 'anchors',
  OBSERVATION_UPDATED: 'observation:updated',
  BENCHMARK_PROGRESS: 'benchmark:progress',
} as const;

