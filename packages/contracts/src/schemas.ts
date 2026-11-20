import { z } from 'zod';

export const NodeKindSchema = z.enum(['browser', 'virtual']);
export const TrustStateSchema = z.enum(['trusted', 'suspect', 'quarantined', 'recovering']);
export const StreamNameSchema = z.enum(['peer', 'oscillator', 'gnss', 'camera']);
export const ReasonCodeSchema = z.enum([
  'PEER_OUTLIER',
  'CUSUM_DRIFT',
  'OSC_STEP',
  'GNSS_DISAGREE',
  'CAMERA_DISAGREE',
  'ANCHOR_DISAGREE',
  'HEARTBEAT_GAP',
  'BAD_SIGNATURE',
  'CHAIN_BREAK',
  'INSUFFICIENT_PEERS',
  'NODE_OFFLINE',
  'RECOVERY_BAND_OK',
]);

export const SuspectedCauseSchema = z.enum([
  'none',
  'local_clock',
  'gnss_spoof',
  'camera_path',
  'network',
  'unknown',
]);

export const ApiErrorCodeSchema = z.enum([
  'BAD_REQUEST',
  'NOT_FOUND',
  'CONFLICT',
  'UNAUTHORIZED',
  'INTERNAL',
]);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ApiErrorCodeSchema,
    message: z.string(),
    details: z.unknown().optional(),
  }),
});

export const NodeInfoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  kind: NodeKindSchema,
  public_key: z.string(),
  created_at: z.string(),
  last_seen_at: z.string().nullable(),
  online: z.boolean(),
});

export const ExchangeSchema = z.object({
  t1: z.number(),
  t2: z.number(),
  t3: z.number(),
  t4: z.number(),
});

export const HeartbeatBodySchema = z.object({
  node_id: z.string().uuid(),
  seq: z.number().int().nonnegative(),
  t_local_ms: z.number(),
  prev_hash: z.string().length(64),
  exchange: z.array(ExchangeSchema),
  osc_residual_ms: z.number().nullable(),
  health: z
    .object({
      cn0_dbhz: z.number().nullable(),
      agc_db: z.number().nullable(),
    })
    .nullable(),
});

export const HeartbeatSchema = HeartbeatBodySchema.extend({
  hash: z.string(),
  sig: z.string(),
});

export const HeartbeatAckSchema = z.discriminatedUnion('ok', [
  z.object({
    ok: z.literal(true),
    server_rx_ms: z.number(),
  }),
  z.object({
    ok: z.literal(false),
    code: z.enum(['BAD_SIGNATURE', 'CHAIN_BREAK', 'UNKNOWN_NODE', 'BAD_REQUEST']),
    expected_seq: z.number().optional(),
    expected_prev_hash: z.string().optional(),
  }),
]);

export const StreamReadingSchema = z.object({
  stream: StreamNameSchema,
  residual_ms: z.number(),
  z: z.number(),
  flagged: z.boolean(),
});

export const AssessmentSchema = z.object({
  node_id: z.string().uuid(),
  t_ms: z.number(),
  state: TrustStateSchema,
  error_est_ms: z.number(),
  sigma_ms: z.number(),
  z: z.number(),
  cusum: z.number(),
  confidence: z.number().min(0).max(1),
  streams: z.array(StreamReadingSchema),
  reasons: z.array(ReasonCodeSchema),
  suspected_cause: SuspectedCauseSchema,
  quarantined_since_ms: z.number().nullable(),
});

export const TransitionSchema = z.object({
  node_id: z.string().uuid(),
  from: TrustStateSchema,
  to: TrustStateSchema,
  at_ms: z.number(),
  reasons: z.array(ReasonCodeSchema),
  error_est_ms: z.number(),
});

export const NetworkHealthSchema = z.object({
  score: z.number().min(0).max(100),
  n: z.number().int().nonnegative(),
  trusted: z.number().int().nonnegative(),
  suspect: z.number().int().nonnegative(),
  quarantined: z.number().int().nonnegative(),
  recovering: z.number().int().nonnegative(),
  fault_tolerance_f: z.number().int().nonnegative(),
  anchor_ok: z.boolean(),
});

export const AnchorInfoSchema = z.object({
  host: z.string(),
  offset_ms: z.number().nullable(),
  rtt_ms: z.number().nullable(),
  ok: z.boolean(),
  sampled_at_ms: z.number(),
});

export const EngineConfigSchema = z.object({
  tolerance_ms: z.number(),
  z_suspect: z.number(),
  z_quarantine: z.number(),
  suspect_min_ticks: z.number().int().positive(),
  quarantine_min_ticks: z.number().int().positive(),
  cusum_k_sigma: z.number(),
  cusum_h_sigma: z.number(),
  recover_band_sigma: z.number(),
  recover_ticks: z.number().int().positive(),
  trusted_after_ticks: z.number().int().positive(),
  min_sigma_ms: z.number().positive(),
  mad_window_s: z.number().int().positive(),
  osc_window_s: z.number().int().positive(),
  heartbeat_timeout_s: z.number().int().positive(),
  gate: z.object({
    trusted: z.number(),
    suspect: z.number(),
    recovering: z.number(),
    quarantined: z.number(),
  }),
  seed: z.number(),
});

export const FaultTypeSchema = z.enum([
  'clock_step',
  'clock_ramp',
  'gnss_spoof',
  'camera_delay',
  'noise_burst',
]);

export const FaultParamsSchema = z.object({
  offset_ms: z.number().optional(),
  rate_ms_per_min: z.number().optional(),
  accel_ms_per_min2: z.number().optional(),
  noise_sigma_ms: z.number().optional(),
  duration_s: z.number().nullable().optional(),
});

export const FaultSpecSchema = z.object({
  type: FaultTypeSchema,
  node_id: z.string().uuid(),
  params: FaultParamsSchema,
});

export const FaultSchema = FaultSpecSchema.extend({
  id: z.string().uuid(),
  started_at_ms: z.number(),
  ends_at_ms: z.number().nullable(),
  status: z.enum(['active', 'stopped', 'expired']),
  applies_to: z.enum(['agent_shim', 'sim']),
  detected_at_ms: z.number().nullable(),
  error_at_detect_ms: z.number().nullable(),
  detection_latency_s: z.number().nullable(),
});

export const IncidentSummarySchema = z.object({
  id: z.string().uuid(),
  node_id: z.string().uuid(),
  node_name: z.string(),
  status: z.enum(['open', 'closed']),
  opened_at_ms: z.number(),
  closed_at_ms: z.number().nullable(),
  peak_error_ms: z.number(),
  detection_latency_s: z.number().nullable(),
  cause: SuspectedCauseSchema,
});

export const IncidentSchema = IncidentSummarySchema.extend({
  summary: z.string(),
  timeline: z.array(TransitionSchema),
  evidence: z.object({
    assessments: z.array(AssessmentSchema),
    chain_head_hash: z.string(),
    anchors: z.array(AnchorInfoSchema),
    fault: FaultSchema.nullable(),
  }),
});

export const ObservationStatusSchema = z.enum(['accepted', 'held', 'released', 'rejected']);

export const ObservationCreateSchema = z.object({
  node_id: z.string().uuid(),
  kind: z.enum(['occultation_timing', 'generic']),
  observed_at_ms: z.number(),
  payload: z.record(z.unknown()),
});

export const ObservationSchema = z.object({
  id: z.string().uuid(),
  node_id: z.string().uuid(),
  kind: z.string(),
  observed_at_ms: z.number(),
  payload: z.record(z.unknown()),
  status: ObservationStatusSchema,
  confidence: z.number(),
  state_at_ingest: TrustStateSchema,
  created_at: z.string(),
});

export const PassportSchema = z.object({
  observation_id: z.string().uuid(),
  node_id: z.string().uuid(),
  observed_at_ms: z.number(),
  corrected_time_ms: z.number(),
  error_est_ms: z.number(),
  sigma_ms: z.number(),
  confidence: z.number(),
  state_at_observation: TrustStateSchema,
  evidence_hash: z.string(),
  chain_head_hash: z.string(),
  issued_at_ms: z.number(),
  server_public_key: z.string(),
  sig: z.string(),
});

export const BaselineStateSchema = z.object({
  source: z.enum(['model', 'chrony']),
  label: z.string(),
  per_node: z.array(
    z.object({
      node_id: z.string().uuid(),
      followed_error_ms: z.number(),
      alarm: z.literal(false),
    }),
  ),
  cluster_time_error_ms: z.number(),
});

export const EllipseSchema = z.object({
  x0: z.number(),
  y0: z.number(),
  a: z.number(),
  b: z.number(),
});

export const ScienceReplayReqSchema = z.object({
  fault_ms: z.number(),
  faulty_station: z.number().int().min(0).max(5),
  quarantine: z.boolean(),
  trials: z.number().int().min(1).max(500).optional(),
  seed: z.number().optional(),
});

export const ScienceStationSchema = z.object({
  idx: z.number(),
  y_m: z.number(),
  chord_x_m: z.tuple([z.number(), z.number()]).nullable(),
  faulty: z.boolean(),
  dropped: z.boolean(),
});

export const ScienceReplayResSchema = z.object({
  truth: EllipseSchema,
  stations: z.array(ScienceStationSchema),
  fitted: EllipseSchema,
  size_error_pct: z.number(),
  mean_size_error_pct: z.number(),
  trials: z.number(),
  params: z.object({
    shadow_speed_kms: z.number(),
    sigma_t_ms: z.number(),
    body_a_m: z.number(),
    body_b_m: z.number(),
  }),
});

export const BenchScenarioSchema = z.enum(['clean', 'jump', 'ramp']);

export const BenchmarkRunReqSchema = z.object({
  scenario: BenchScenarioSchema,
  repeats: z.number().int().min(1).max(500),
  seed: z.number(),
  params: z
    .object({
      offset_ms: z.number().optional(),
      rate_ms_per_min: z.number().optional(),
      tolerance_ms: z.number().optional(),
    })
    .optional(),
});

export const DistSchema = z.object({
  median: z.number(),
  p90: z.number(),
});

export const BenchmarkRunSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['queued', 'running', 'done', 'failed']),
  scenario: BenchScenarioSchema,
  repeats: z.number(),
  seed: z.number(),
  params: z.record(z.unknown()),
  created_at: z.string(),
  progress: z.object({
    done: z.number(),
    total: z.number(),
  }),
  results: z
    .object({
      noise_model: z.literal('simulated'),
      n_nodes: z.number(),
      time_to_detect_s: DistSchema.nullable(),
      error_at_detect_ms: DistSchema.nullable(),
      detect_rate: z.number(),
      false_alarms_per_hour: z.number().nullable(),
      baseline_detect_rate: z.number(),
      science_error_pct: z
        .object({
          without: z.number(),
          with: z.number(),
        })
        .nullable(),
    })
    .nullable(),
});

export const LiveMetricsSchema = z.object({
  faults: z.array(
    z.object({
      fault_id: z.string().uuid(),
      type: FaultTypeSchema,
      node_name: z.string(),
      injected_at_ms: z.number(),
      detected_at_ms: z.number().nullable(),
      detection_latency_s: z.number().nullable(),
      error_at_detect_ms: z.number().nullable(),
      peak_true_error_ms: z.number(),
      baseline_alarmed: z.literal(false),
    }),
  ),
  summary: z.object({
    count: z.number(),
    detected: z.number(),
    median_latency_s: z.number().nullable(),
  }),
});

export const SnapshotSchema = z.object({
  contract_version: z.string(),
  server_time_ms: z.number(),
  nodes: z.array(NodeInfoSchema),
  assessments: z.array(AssessmentSchema),
  network: NetworkHealthSchema,
  anchors: z.array(AnchorInfoSchema),
  faults: z.array(FaultSchema),
  baseline: BaselineStateSchema,
  config: EngineConfigSchema,
  open_incidents: z.array(IncidentSummarySchema),
});

export const HistoryPointSchema = z.object({
  t_ms: z.number(),
  error_est_ms: z.number(),
  sigma_ms: z.number(),
  confidence: z.number(),
  state: TrustStateSchema,
  streams: z.record(StreamNameSchema, z.number()),
  injected_error_ms: z.number().nullable(),
});

export const JoinInfoSchema = z.object({
  join_url: z.string(),
  ws_url: z.string(),
  api_url: z.string(),
});

export const DemoScenarioNameSchema = z.enum([
  'calm',
  'jump',
  'slow_drag',
  'gnss_spoof',
  'judge_attack',
]);

// Route Specific Request & Response Schemas
export const HealthResponseSchema = z.object({
  ok: z.literal(true),
  contract_version: z.string(),
  server_time_ms: z.number(),
  db: z.enum(['up', 'down']),
  anchors_ok: z.boolean(),
});

export const RegisterNodeReqSchema = z.object({
  name: z.string(),
  kind: z.literal('browser'),
  public_key: z.string(),
});

export const RegisterNodeResSchema = z.object({
  node: NodeInfoSchema,
  hub_time_ms: z.number(),
});

export const NodeHistoryQuerySchema = z.object({
  window_s: z.coerce.number().int().min(30).max(3600).default(300),
});

export const IncidentsQuerySchema = z.object({
  status: z.enum(['open', 'closed', 'all']).default('all'),
  limit: z.coerce.number().int().positive().default(50),
});

export const ObservationsQuerySchema = z.object({
  node_id: z.string().uuid().optional(),
  status: ObservationStatusSchema.optional(),
  limit: z.coerce.number().int().positive().default(100),
});

export const FaultsQuerySchema = z.object({
  status: z.enum(['active', 'all']).default('all'),
});

export const PatchConfigReqSchema = EngineConfigSchema.pick({
  tolerance_ms: true,
  z_suspect: true,
  z_quarantine: true,
  cusum_k_sigma: true,
  cusum_h_sigma: true,
}).partial();

export const DemoScenarioReqSchema = z.object({
  name: DemoScenarioNameSchema,
  target_node_id: z.string().uuid().optional(),
});

export const DemoResetReqSchema = z.object({
  hard: z.boolean().optional(),
});

