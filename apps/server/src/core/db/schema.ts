// Chronyx Frozen Database Schema Types (Part E3)
// All table shapes correspond exactly to supabase/migrations/0001_init.sql

import type {
  UUID,
  Iso,
  NodeKind,
  TrustState,
  FaultType,
  ObservationStatus,
  BenchScenario,
} from '@chronyx/contracts';

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

export type NodeRow = {
  id: UUID;
  name: string;
  kind: NodeKind;
  public_key: string;
  created_at: Iso;
  last_seen_at: Iso | null;
};

export type NodeInsert = {
  id?: UUID;
  name: string;
  kind: NodeKind;
  public_key: string;
  created_at?: Iso;
  last_seen_at?: Iso | null;
};

export type NodeUpdate = Partial<NodeInsert>;

export type HeartbeatRow = {
  id: number;
  node_id: UUID;
  seq: number;
  t_local_ms: number;
  t_rx_ms: number;
  prev_hash: string;
  hash: string;
  sig: string;
  body: Json;
  flags: string[];
};

export type HeartbeatInsert = {
  id?: number;
  node_id: UUID;
  seq: number;
  t_local_ms: number;
  t_rx_ms: number;
  prev_hash: string;
  hash: string;
  sig: string;
  body: Json;
  flags?: string[];
};

export type HeartbeatUpdate = Partial<HeartbeatInsert>;

export type AssessmentRow = {
  id: number;
  node_id: UUID;
  t_ms: number;
  state: TrustState;
  error_est_ms: number | null;
  sigma_ms: number | null;
  z: number | null;
  cusum: number | null;
  confidence: number | null;
  reasons: string[];
  suspected_cause: string | null;
  streams: Json | null;
};

export type AssessmentInsert = {
  id?: number;
  node_id: UUID;
  t_ms: number;
  state: TrustState;
  error_est_ms?: number | null;
  sigma_ms?: number | null;
  z?: number | null;
  cusum?: number | null;
  confidence?: number | null;
  reasons?: string[];
  suspected_cause?: string | null;
  streams?: Json | null;
};

export type AssessmentUpdate = Partial<AssessmentInsert>;

export type TransitionRow = {
  id: number;
  node_id: UUID;
  at_ms: number;
  from_state: TrustState;
  to_state: TrustState;
  reasons: string[];
  error_est_ms: number | null;
  incident_id: UUID | null;
};

export type TransitionInsert = {
  id?: number;
  node_id: UUID;
  at_ms: number;
  from_state: TrustState;
  to_state: TrustState;
  reasons?: string[];
  error_est_ms?: number | null;
  incident_id?: UUID | null;
};

export type TransitionUpdate = Partial<TransitionInsert>;

export type IncidentRow = {
  id: UUID;
  node_id: UUID;
  status: 'open' | 'closed';
  opened_at_ms: number;
  closed_at_ms: number | null;
  peak_error_ms: number;
  detection_latency_s: number | null;
  cause: string;
  summary: string;
  evidence: Json;
};

export type IncidentInsert = {
  id?: UUID;
  node_id: UUID;
  status: 'open' | 'closed';
  opened_at_ms: number;
  closed_at_ms?: number | null;
  peak_error_ms?: number;
  detection_latency_s?: number | null;
  cause?: string;
  summary?: string;
  evidence?: Json;
};

export type IncidentUpdate = Partial<IncidentInsert>;

export type FaultRow = {
  id: UUID;
  type: FaultType;
  node_id: UUID;
  params: Json;
  started_at_ms: number;
  ends_at_ms: number | null;
  status: 'active' | 'stopped' | 'expired';
  applies_to: 'agent_shim' | 'sim';
  detected_at_ms: number | null;
  error_at_detect_ms: number | null;
  detection_latency_s: number | null;
};

export type FaultInsert = {
  id?: UUID;
  type: FaultType;
  node_id: UUID;
  params: Json;
  started_at_ms: number;
  ends_at_ms?: number | null;
  status: 'active' | 'stopped' | 'expired';
  applies_to: 'agent_shim' | 'sim';
  detected_at_ms?: number | null;
  error_at_detect_ms?: number | null;
  detection_latency_s?: number | null;
};

export type FaultUpdate = Partial<FaultInsert>;

export type ObservationRow = {
  id: UUID;
  node_id: UUID;
  kind: string;
  observed_at_ms: number;
  payload: Json;
  status: ObservationStatus;
  confidence: number;
  state_at_ingest: TrustState;
  created_at: Iso;
};

export type ObservationInsert = {
  id?: UUID;
  node_id: UUID;
  kind: string;
  observed_at_ms: number;
  payload?: Json;
  status: ObservationStatus;
  confidence: number;
  state_at_ingest: TrustState;
  created_at?: Iso;
};

export type ObservationUpdate = Partial<ObservationInsert>;

export type BenchmarkRunRow = {
  id: UUID;
  status: 'queued' | 'running' | 'done' | 'failed';
  scenario: BenchScenario;
  repeats: number;
  seed: number;
  params: Json;
  progress: Json;
  results: Json | null;
  created_at: Iso;
};

export type BenchmarkRunInsert = {
  id?: UUID;
  status: 'queued' | 'running' | 'done' | 'failed';
  scenario: BenchScenario;
  repeats: number;
  seed: number;
  params?: Json;
  progress?: Json;
  results?: Json | null;
  created_at?: Iso;
};

export type BenchmarkRunUpdate = Partial<BenchmarkRunInsert>;

export type AnchorRow = {
  id: number;
  host: string;
  offset_ms: number | null;
  rtt_ms: number | null;
  ok: boolean;
  sampled_at_ms: number;
};

export type AnchorInsert = {
  id?: number;
  host: string;
  offset_ms?: number | null;
  rtt_ms?: number | null;
  ok: boolean;
  sampled_at_ms: number;
};

export type AnchorUpdate = Partial<AnchorInsert>;

export type ConfigRow = {
  key: string;
  value: Json;
};

export type ConfigInsert = {
  key: string;
  value: Json;
};

export type ConfigUpdate = Partial<ConfigInsert>;

export type ChronyxDatabase = {
  public: {
    Tables: {
      nodes: {
        Row: NodeRow;
        Insert: NodeInsert;
        Update: NodeUpdate;
        Relationships: [];
      };
      heartbeats: {
        Row: HeartbeatRow;
        Insert: HeartbeatInsert;
        Update: HeartbeatUpdate;
        Relationships: [
          {
            foreignKeyName: 'heartbeats_node_id_fkey';
            columns: ['node_id'];
            isOneToOne: false;
            referencedRelation: 'nodes';
            referencedColumns: ['id'];
          },
        ];
      };
      assessments: {
        Row: AssessmentRow;
        Insert: AssessmentInsert;
        Update: AssessmentUpdate;
        Relationships: [
          {
            foreignKeyName: 'assessments_node_id_fkey';
            columns: ['node_id'];
            isOneToOne: false;
            referencedRelation: 'nodes';
            referencedColumns: ['id'];
          },
        ];
      };
      transitions: {
        Row: TransitionRow;
        Insert: TransitionInsert;
        Update: TransitionUpdate;
        Relationships: [
          {
            foreignKeyName: 'transitions_node_id_fkey';
            columns: ['node_id'];
            isOneToOne: false;
            referencedRelation: 'nodes';
            referencedColumns: ['id'];
          },
        ];
      };
      incidents: {
        Row: IncidentRow;
        Insert: IncidentInsert;
        Update: IncidentUpdate;
        Relationships: [
          {
            foreignKeyName: 'incidents_node_id_fkey';
            columns: ['node_id'];
            isOneToOne: false;
            referencedRelation: 'nodes';
            referencedColumns: ['id'];
          },
        ];
      };
      faults: {
        Row: FaultRow;
        Insert: FaultInsert;
        Update: FaultUpdate;
        Relationships: [
          {
            foreignKeyName: 'faults_node_id_fkey';
            columns: ['node_id'];
            isOneToOne: false;
            referencedRelation: 'nodes';
            referencedColumns: ['id'];
          },
        ];
      };
      observations: {
        Row: ObservationRow;
        Insert: ObservationInsert;
        Update: ObservationUpdate;
        Relationships: [
          {
            foreignKeyName: 'observations_node_id_fkey';
            columns: ['node_id'];
            isOneToOne: false;
            referencedRelation: 'nodes';
            referencedColumns: ['id'];
          },
        ];
      };
      benchmark_runs: {
        Row: BenchmarkRunRow;
        Insert: BenchmarkRunInsert;
        Update: BenchmarkRunUpdate;
        Relationships: [];
      };
      anchors: {
        Row: AnchorRow;
        Insert: AnchorInsert;
        Update: AnchorUpdate;
        Relationships: [];
      };
      config: {
        Row: ConfigRow;
        Insert: ConfigInsert;
        Update: ConfigUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};
