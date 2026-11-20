// MOCK-DATA (remove before main)
import type {
  NodeInfo,
  Heartbeat,
  HeartbeatAck,
  Assessment,
  Transition,
  NetworkHealth,
  AnchorInfo,
  Fault,
  IncidentSummary,
  Incident,
  Observation,
  Passport,
  BaselineState,
  Snapshot,
  HistoryPoint,
  LiveMetrics,
  BenchmarkRun,
  ScienceReplayRes,
  JoinInfo,
} from './types.js';
import { GENESIS_PREV_HASH, DEFAULT_ENGINE_CONFIG } from './constants.js';

export const mockNodeInfo: NodeInfo = {
  id: '00000000-0000-0000-0000-000000000001',
  name: 'V-Alpha',
  kind: 'virtual',
  public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000000=',
  created_at: '2026-11-20T12:00:00.000Z',
  last_seen_at: '2026-11-20T12:00:01.000Z',
  online: true,
};

export const mockHeartbeat: Heartbeat = {
  node_id: '00000000-0000-0000-0000-000000000001',
  seq: 0,
  t_local_ms: 1700000000000,
  prev_hash: GENESIS_PREV_HASH,
  exchange: [{ t1: 1700000000000, t2: 1700000000005, t3: 1700000000006, t4: 1700000000011 }],
  osc_residual_ms: 0.02,
  health: { cn0_dbhz: 45.2, agc_db: 20.1 },
  hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  sig: 'dGVzdF9zaWduYXR1cmVfZGF0YV9mb3JfbW9ja19maXh0dXJlX29ubHlfaGVyZQ==',
};

export const mockHeartbeatAck: HeartbeatAck = {
  ok: true,
  server_rx_ms: 1700000000005,
};

export const mockAssessment: Assessment = {
  node_id: '00000000-0000-0000-0000-000000000001',
  t_ms: 1700000000000,
  state: 'trusted',
  error_est_ms: 0.12,
  sigma_ms: 0.28,
  z: 0.42,
  cusum: 0.15,
  confidence: 0.99,
  streams: [
    { stream: 'peer', residual_ms: 0.12, z: 0.42, flagged: false },
    { stream: 'oscillator', residual_ms: 0.05, z: 0.15, flagged: false },
    { stream: 'gnss', residual_ms: 0.02, z: 0.08, flagged: false },
    { stream: 'camera', residual_ms: 0.09, z: 0.31, flagged: false },
  ],
  reasons: [],
  suspected_cause: 'none',
  quarantined_since_ms: null,
};

export const mockTransition: Transition = {
  node_id: '00000000-0000-0000-0000-000000000001',
  from: 'trusted',
  to: 'suspect',
  at_ms: 1700000005000,
  reasons: ['PEER_OUTLIER'],
  error_est_ms: 4.5,
};

export const mockNetworkHealth: NetworkHealth = {
  score: 98,
  n: 4,
  trusted: 4,
  suspect: 0,
  quarantined: 0,
  recovering: 0,
  fault_tolerance_f: 1,
  anchor_ok: true,
};

export const mockAnchorInfo: AnchorInfo = {
  host: 'time.nplindia.org',
  offset_ms: 0.15,
  rtt_ms: 12.4,
  ok: true,
  sampled_at_ms: 1700000000000,
};

export const mockFault: Fault = {
  id: '00000000-0000-0000-0000-000000000010',
  type: 'clock_step',
  node_id: '00000000-0000-0000-0000-000000000001',
  params: { offset_ms: 10 },
  started_at_ms: 1700000000000,
  ends_at_ms: null,
  status: 'active',
  applies_to: 'sim',
  detected_at_ms: 1700000003000,
  error_at_detect_ms: 10.05,
  detection_latency_s: 3,
};

export const mockIncidentSummary: IncidentSummary = {
  id: '00000000-0000-0000-0000-000000000020',
  node_id: '00000000-0000-0000-0000-000000000001',
  node_name: 'V-Alpha',
  status: 'closed',
  opened_at_ms: 1700000003000,
  closed_at_ms: 1700000065000,
  peak_error_ms: 10.1,
  detection_latency_s: 3,
  cause: 'local_clock',
};

export const mockIncident: Incident = {
  ...mockIncidentSummary,
  summary: 'Node V-Alpha experienced a 10 ms clock step and was quarantined.',
  timeline: [mockTransition],
  evidence: {
    assessments: [mockAssessment],
    chain_head_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    anchors: [mockAnchorInfo],
    fault: mockFault,
  },
};

export const mockObservation: Observation = {
  id: '00000000-0000-0000-0000-000000000030',
  node_id: '00000000-0000-0000-0000-000000000001',
  kind: 'occultation_timing',
  observed_at_ms: 1700000010000,
  payload: { chord_ms: 450.2, star: 'UCAC4-123-456' },
  status: 'accepted',
  confidence: 0.99,
  state_at_ingest: 'trusted',
  created_at: '2026-11-20T12:00:10.000Z',
};

export const mockPassport: Passport = {
  observation_id: '00000000-0000-0000-0000-000000000030',
  node_id: '00000000-0000-0000-0000-000000000001',
  observed_at_ms: 1700000010000,
  corrected_time_ms: 1700000009999.88,
  error_est_ms: 0.12,
  sigma_ms: 0.28,
  confidence: 0.99,
  state_at_observation: 'trusted',
  evidence_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  chain_head_hash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
  issued_at_ms: 1700000011000,
  server_public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000000=',
  sig: 'dGVzdF9zaWduYXR1cmVfZGF0YV9mb3JfcGFzc3BvcnRfb25seQ==',
};

export const mockBaselineState: BaselineState = {
  source: 'model',
  label: 'Naive follower (model)',
  per_node: [
    {
      node_id: '00000000-0000-0000-0000-000000000001',
      followed_error_ms: 0.05,
      alarm: false,
    },
  ],
  cluster_time_error_ms: 0.05,
};

export const mockSnapshot: Snapshot = {
  contract_version: '1.0.0',
  server_time_ms: 1700000000000,
  nodes: [mockNodeInfo],
  assessments: [mockAssessment],
  network: mockNetworkHealth,
  anchors: [mockAnchorInfo],
  faults: [],
  baseline: mockBaselineState,
  config: DEFAULT_ENGINE_CONFIG,
  open_incidents: [],
};

export const mockHistoryPoint: HistoryPoint = {
  t_ms: 1700000000000,
  error_est_ms: 0.12,
  sigma_ms: 0.28,
  confidence: 0.99,
  state: 'trusted',
  streams: { peer: 0.12, oscillator: 0.05, gnss: 0.02, camera: 0.09 },
  injected_error_ms: null,
};

export const mockJoinInfo: JoinInfo = {
  join_url: 'http://localhost:5173/join',
  ws_url: 'http://localhost:3001',
  api_url: 'http://localhost:3001',
};

export const mockLiveMetrics: LiveMetrics = {
  faults: [
    {
      fault_id: '00000000-0000-0000-0000-000000000010',
      type: 'clock_step',
      node_name: 'V-Alpha',
      injected_at_ms: 1700000000000,
      detected_at_ms: 1700000003000,
      detection_latency_s: 3,
      error_at_detect_ms: 10.05,
      peak_true_error_ms: 10.0,
      baseline_alarmed: false,
    },
  ],
  summary: {
    count: 1,
    detected: 1,
    median_latency_s: 3,
  },
};

export const mockBenchmarkRun: BenchmarkRun = {
  id: '00000000-0000-0000-0000-000000000040',
  status: 'done',
  scenario: 'jump',
  repeats: 50,
  seed: 42,
  params: { offset_ms: 10 },
  created_at: '2026-11-20T12:00:00.000Z',
  progress: { done: 50, total: 50 },
  results: {
    noise_model: 'simulated',
    n_nodes: 4,
    time_to_detect_s: { median: 3.1, p90: 4.2 },
    error_at_detect_ms: { median: 10.0, p90: 10.2 },
    detect_rate: 1.0,
    false_alarms_per_hour: 0,
    baseline_detect_rate: 0,
    science_error_pct: { without: 12.5, with: 1.8 },
  },
};

export const mockScienceReplayRes: ScienceReplayRes = {
  truth: { x0: 0, y0: 0, a: 250, b: 150 },
  stations: [
    { idx: 0, y_m: -110, chord_x_m: [-170, 170], faulty: false, dropped: false },
    { idx: 1, y_m: -60, chord_x_m: [-229, 229], faulty: false, dropped: false },
    { idx: 2, y_m: -15, chord_x_m: [-248, 248], faulty: false, dropped: false },
    { idx: 3, y_m: 35, chord_x_m: [-243, 243], faulty: false, dropped: false },
    { idx: 4, y_m: 85, chord_x_m: [-206, 206], faulty: false, dropped: false },
    { idx: 5, y_m: 125, chord_x_m: [-138, 138], faulty: true, dropped: true },
  ],
  fitted: { x0: 0.2, y0: -0.1, a: 249.5, b: 150.2 },
  size_error_pct: 0.17,
  mean_size_error_pct: 0.17,
  trials: 1,
  params: {
    shadow_speed_kms: 20,
    sigma_t_ms: 0.2,
    body_a_m: 250,
    body_b_m: 150,
  },
};

