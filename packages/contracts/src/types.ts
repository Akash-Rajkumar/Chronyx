// Frozen Chronyx Contracts v1.0.0 (Part E)
// All times are milliseconds since Unix epoch as numbers unless Iso string.
// All JSON keys are snake_case.

export const CONTRACT_VERSION = '1.0.0';
export type UUID = string;
export type Iso = string; // Iso = ISO-8601 UTC

export type NodeKind = 'browser' | 'virtual';
export type TrustState = 'trusted' | 'suspect' | 'quarantined' | 'recovering';
export type StreamName = 'peer' | 'oscillator' | 'gnss' | 'camera';
export type ReasonCode =
  | 'PEER_OUTLIER'
  | 'CUSUM_DRIFT'
  | 'OSC_STEP'
  | 'GNSS_DISAGREE'
  | 'CAMERA_DISAGREE'
  | 'ANCHOR_DISAGREE'
  | 'HEARTBEAT_GAP'
  | 'BAD_SIGNATURE'
  | 'CHAIN_BREAK'
  | 'INSUFFICIENT_PEERS'
  | 'NODE_OFFLINE'
  | 'RECOVERY_BAND_OK';

export type SuspectedCause =
  | 'none'
  | 'local_clock'
  | 'gnss_spoof'
  | 'camera_path'
  | 'network'
  | 'unknown';

export interface ApiError {
  error: {
    code: 'BAD_REQUEST' | 'NOT_FOUND' | 'CONFLICT' | 'UNAUTHORIZED' | 'INTERNAL';
    message: string;
    details?: unknown;
  };
}

export interface NodeInfo {
  id: UUID;
  name: string;
  kind: NodeKind;
  public_key: string; /* base64, 32 bytes */
  created_at: Iso;
  last_seen_at: Iso | null;
  online: boolean;
}

/** One two-way exchange with the hub. t1 node send, t2 hub receive, t3 hub send, t4 node receive. */
export interface Exchange {
  t1: number;
  t2: number;
  t3: number;
  t4: number;
}

export interface HeartbeatBody {
  node_id: UUID;
  seq: number; // starts at 0 (or at next_seq from node:join), +1 each heartbeat
  t_local_ms: number; // node's claimed clock at send (nodeNow())
  prev_hash: string; // 64 hex; genesis = 64 zeros
  exchange: Exchange[]; // 0..8 most recent exchanges
  osc_residual_ms: number | null; // cumulative (nodeNow delta) minus (performance.now delta) since agent start
  health: { cn0_dbhz: number | null; agc_db: number | null } | null;
}

export interface Heartbeat extends HeartbeatBody {
  hash: string;
  sig: string;
}

export type HeartbeatAck =
  | { ok: true; server_rx_ms: number }
  | {
      ok: false;
      code: 'BAD_SIGNATURE' | 'CHAIN_BREAK' | 'UNKNOWN_NODE' | 'BAD_REQUEST';
      expected_seq?: number;
      expected_prev_hash?: string;
    };

export interface StreamReading {
  stream: StreamName;
  residual_ms: number;
  z: number;
  flagged: boolean;
}

export interface Assessment {
  node_id: UUID;
  t_ms: number;
  state: TrustState;
  error_est_ms: number; // signed, node clock minus cluster consensus (positive = node ahead)
  sigma_ms: number; // 1-sigma uncertainty of that estimate
  z: number; // robust z-score of the primary (peer) evidence
  cusum: number; // max(S+, S-) in sigma units
  confidence: number; // 0..1, see E3 formula
  streams: StreamReading[]; // only streams that exist for this node
  reasons: ReasonCode[];
  suspected_cause: SuspectedCause;
  quarantined_since_ms: number | null;
}

export interface Transition {
  node_id: UUID;
  from: TrustState;
  to: TrustState;
  at_ms: number;
  reasons: ReasonCode[];
  error_est_ms: number;
}

export interface NetworkHealth {
  score: number; /* 0..100 */
  n: number;
  trusted: number;
  suspect: number;
  quarantined: number;
  recovering: number;
  fault_tolerance_f: number; /* floor((n-1)/3) */
  anchor_ok: boolean;
}

export interface AnchorInfo {
  host: string;
  offset_ms: number | null;
  rtt_ms: number | null;
  ok: boolean;
  sampled_at_ms: number;
}

export interface NodeTickInput {
  node_id: UUID;
  online: boolean;
  peer_offset_ms: number | null; // node clock minus hub clock from min-RTT exchange
  osc_residual_ms: number | null; // cumulative, as in heartbeat
  gnss_resid_ms: number | null; // node clock minus GNSS time (virtual nodes only)
  camera_resid_ms: number | null; // camera-trigger stamp minus expected (virtual nodes only)
  health: { cn0_dbhz: number | null; agc_db: number | null } | null;
  integrity: {
    bad_signature: boolean;
    chain_break: boolean;
    heartbeat_gap: boolean;
  };
}

export interface EngineTickInput {
  now_ms: number;
  nodes: NodeTickInput[];
  anchor: {
    ok: boolean;
    offset_ms: number | null;
    sigma_ms: number | null;
  }; // hub clock minus public anchors
}

export interface EngineTickOutput {
  now_ms: number;
  assessments: Assessment[];
  transitions: Transition[];
  network: NetworkHealth;
  consensus_ms: number;
}

export interface EngineConfig {
  tolerance_ms: number; // 10 science tolerance used by confidence (UI slider)
  z_suspect: number; // 3.5 |z| to count toward suspect
  z_quarantine: number; // 5 |z| to count toward quarantine
  suspect_min_ticks: number; // 2 consecutive ticks
  quarantine_min_ticks: number; // 3 consecutive ticks
  cusum_k_sigma: number; // 0.5 CUSUM reference value, in sigma units
  cusum_h_sigma: number; // 11.4 CUSUM threshold
  recover_band_sigma: number; // 2 |z| below this counts as calm
  recover_ticks: number; // 30 calm ticks needed to go quarantined/suspect -> recovering
  trusted_after_ticks: number; // 60 further calm ticks needed recovering -> trusted
  min_sigma_ms: number; // 0.25 floor for noise estimate
  mad_window_s: number; // 300 history window for noise estimate
  osc_window_s: number; // 60 oscillator stream window
  heartbeat_timeout_s: number; // 5 no heartbeat for this long -> offline
  gate: {
    trusted: number;
    suspect: number;
    recovering: number;
    quarantined: number;
  }; // 1, 0.5, 0.7, 0
  seed: number; // 42
}

export interface IEngine {
  tick(i: EngineTickInput): EngineTickOutput;
  reset(): void;
  setConfig(c: Partial<EngineConfig>): void;
  getConfig(): EngineConfig;
}

export interface SimNodeOutput {
  node: NodeInfo;
  heartbeat: Heartbeat;
  gnss_resid_ms: number;
  camera_resid_ms: number;
}

export interface ISim {
  addVirtualNode(name: string): NodeInfo;
  step(now_ms: number): SimNodeOutput[];
  applyFault(f: Fault): void;
  stopFault(id: UUID): void;
  faultOffsetMs(node_id: UUID, now_ms: number): number;
}

export type FaultType =
  | 'clock_step'
  | 'clock_ramp'
  | 'gnss_spoof'
  | 'camera_delay'
  | 'noise_burst';

export interface FaultParams {
  offset_ms?: number;
  rate_ms_per_min?: number;
  accel_ms_per_min2?: number;
  noise_sigma_ms?: number;
  duration_s?: number | null;
}

export interface FaultSpec {
  type: FaultType;
  node_id: UUID;
  params: FaultParams;
}

export interface Fault extends FaultSpec {
  id: UUID;
  started_at_ms: number;
  ends_at_ms: number | null;
  status: 'active' | 'stopped' | 'expired';
  applies_to: 'agent_shim' | 'sim';
  detected_at_ms: number | null;
  error_at_detect_ms: number | null;
  detection_latency_s: number | null;
}

export interface IncidentSummary {
  id: UUID;
  node_id: UUID;
  node_name: string;
  status: 'open' | 'closed';
  opened_at_ms: number;
  closed_at_ms: number | null;
  peak_error_ms: number;
  detection_latency_s: number | null;
  cause: SuspectedCause;
}

export interface Incident extends IncidentSummary {
  summary: string;
  timeline: Transition[];
  evidence: {
    assessments: Assessment[]; /* <=120 around the event */
    chain_head_hash: string;
    anchors: AnchorInfo[];
    fault: Fault | null;
  };
}

export type ObservationStatus = 'accepted' | 'held' | 'released' | 'rejected';

export interface ObservationCreate {
  node_id: UUID;
  kind: 'occultation_timing' | 'generic';
  observed_at_ms: number;
  payload: Record<string, unknown>;
}

export interface Observation {
  id: UUID;
  node_id: UUID;
  kind: string;
  observed_at_ms: number;
  payload: Record<string, unknown>;
  status: ObservationStatus;
  confidence: number;
  state_at_ingest: TrustState;
  created_at: Iso;
}

export interface Passport {
  observation_id: UUID;
  node_id: UUID;
  observed_at_ms: number;
  corrected_time_ms: number; /* observed_at_ms - error_est_ms */
  error_est_ms: number;
  sigma_ms: number;
  confidence: number;
  state_at_observation: TrustState;
  evidence_hash: string;
  chain_head_hash: string;
  issued_at_ms: number;
  server_public_key: string;
  sig: string; /* ed25519 over sha256(canonicalJson(rest)) */
}

export interface BaselineState {
  source: 'model' | 'chrony';
  label: string; // e.g. 'Naive follower (model)'
  per_node: {
    node_id: UUID;
    followed_error_ms: number;
    alarm: false;
  }[];
  cluster_time_error_ms: number;
}

export interface Ellipse {
  x0: number;
  y0: number;
  a: number;
  b: number;
}

export interface ScienceReplayReq {
  fault_ms: number;
  faulty_station: number; /* 0..5 */
  quarantine: boolean;
  trials?: number; /* 1..500, default 200 */
  seed?: number;
}

export interface ScienceStation {
  idx: number;
  y_m: number;
  chord_x_m: [number, number] | null;
  faulty: boolean;
  dropped: boolean;
}

export interface ScienceReplayRes {
  truth: Ellipse;
  stations: ScienceStation[]; /* first trial */
  fitted: Ellipse;
  size_error_pct: number; /* first trial */
  mean_size_error_pct: number;
  trials: number;
  params: {
    shadow_speed_kms: number;
    sigma_t_ms: number;
    body_a_m: number;
    body_b_m: number;
  };
}

export type BenchScenario = 'clean' | 'jump' | 'ramp';

export interface BenchmarkRunReq {
  scenario: BenchScenario;
  repeats: number; /* 1..500 */
  seed: number;
  params?: {
    offset_ms?: number;
    rate_ms_per_min?: number;
    tolerance_ms?: number;
  };
}

export interface Dist {
  median: number;
  p90: number;
}

export interface BenchmarkRun {
  id: UUID;
  status: 'queued' | 'running' | 'done' | 'failed';
  scenario: BenchScenario;
  repeats: number;
  seed: number;
  params: object;
  created_at: Iso;
  progress: {
    done: number;
    total: number;
  };
  results: null | {
    noise_model: 'simulated';
    n_nodes: number;
    time_to_detect_s: Dist | null;
    error_at_detect_ms: Dist | null;
    detect_rate: number;
    false_alarms_per_hour: number | null;
    baseline_detect_rate: number;
    science_error_pct: {
      without: number;
      with: number;
    } | null;
  };
}

export interface LiveMetrics {
  faults: {
    fault_id: UUID;
    type: FaultType;
    node_name: string;
    injected_at_ms: number;
    detected_at_ms: number | null;
    detection_latency_s: number | null;
    error_at_detect_ms: number | null;
    peak_true_error_ms: number;
    baseline_alarmed: false;
  }[];
  summary: {
    count: number;
    detected: number;
    median_latency_s: number | null;
  };
}

export interface Snapshot {
  contract_version: string;
  server_time_ms: number;
  nodes: NodeInfo[];
  assessments: Assessment[];
  network: NetworkHealth;
  anchors: AnchorInfo[];
  faults: Fault[];
  baseline: BaselineState;
  config: EngineConfig;
  open_incidents: IncidentSummary[];
}

export interface HistoryPoint {
  t_ms: number;
  error_est_ms: number;
  sigma_ms: number;
  confidence: number;
  state: TrustState;
  streams: Partial<Record<StreamName, number>>;
  injected_error_ms: number | null;
}

export interface JoinInfo {
  join_url: string;
  ws_url: string;
  api_url: string;
}

export type DemoScenarioName =
  | 'calm'
  | 'jump'
  | 'slow_drag'
  | 'gnss_spoof'
  | 'judge_attack';

