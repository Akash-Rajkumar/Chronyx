// Internal seams (frozen with contracts, defined by P1 in S0, Part F)
import type {
  IEngine,
  ISim,
  Assessment,
  NodeInfo,
  FaultSpec,
  Fault,
  UUID,
} from '@chronyx/contracts';

export interface IFaultService {
  start(spec: FaultSpec): Promise<Fault>;
  stop(id: UUID): Promise<Fault>;
  active(): Fault[];
  injectedErrorMs(node_id: UUID, now_ms: number): number;
  markDetected(fault_id: UUID, at_ms: number, error_ms: number): Promise<void>;
}

export type Db = unknown; // Typed in P1-T2 with Supabase

export interface LabContext {
  now(): number;
  hubNow(): number;
  engine: IEngine;
  sim: ISim;
  faults: IFaultService;
  db: Db;
  emit(event: string, payload: unknown): void;
  sendToNode(node_id: UUID, event: 'fault:apply' | 'fault:clear', payload: unknown): void;
  getAssessments(): Assessment[];
  getNodes(): NodeInfo[];
  getBaselineInputs(): { node_id: UUID; true_error_ms: number }[];
}

