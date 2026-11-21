import type { Fault, FaultSpec, ISim, NodeInfo, UUID } from '@chronyx/contracts';
import { FaultSpecSchema, SOCKET_EVENTS } from '@chronyx/contracts';
import { faultContributionMs } from '@chronyx/sim';
import type { IFaultService } from '../ctx.js';
import { FaultRegistry } from './faultRegistry.js';

export interface LabFaultServiceDeps {
  registry: FaultRegistry;
  now: () => number;
  getNodes: () => readonly NodeInfo[];
  sim: ISim;
  sendToNode: (nodeId: UUID, event: 'fault:apply' | 'fault:clear', payload: unknown) => void;
  emit: (event: string, payload: unknown) => void;
  newId: () => UUID;
}

function endsAtFromDuration(startedAtMs: number, durationS: number | null | undefined): number | null {
  if (typeof durationS === 'number' && Number.isFinite(durationS)) {
    return startedAtMs + durationS * 1000;
  }
  return null;
}

export class LabFaultService implements IFaultService {
  public constructor(private readonly deps: LabFaultServiceDeps) {}

  public get registry(): FaultRegistry {
    return this.deps.registry;
  }

  public async start(spec: FaultSpec): Promise<Fault> {
    const parsed = FaultSpecSchema.parse(spec);
    const node = this.requireNode(parsed.node_id);
    const startedAtMs = this.deps.now();
    const appliesTo = node.kind === 'virtual' ? 'sim' : 'agent_shim';
    const fault: Fault = {
      type: parsed.type,
      node_id: parsed.node_id,
      params: { ...parsed.params },
      id: this.deps.newId(),
      started_at_ms: startedAtMs,
      ends_at_ms: endsAtFromDuration(startedAtMs, parsed.params.duration_s),
      status: 'active',
      applies_to: appliesTo,
      detected_at_ms: null,
      error_at_detect_ms: null,
      detection_latency_s: null,
    };
    this.deps.registry.add(fault);
    if (appliesTo === 'sim') {
      this.deps.sim.applyFault(fault);
    } else {
      this.deps.sendToNode(fault.node_id, 'fault:apply', fault);
    }
    const stored = this.deps.registry.get(fault.id);
    if (!stored) throw new Error(`Fault ${fault.id} was not stored`);
    this.deps.emit(SOCKET_EVENTS.FAULT_CHANGED, stored);
    return stored;
  }

  public async stop(id: UUID): Promise<Fault> {
    return this.stopSync(id);
  }

  public active(): Fault[] {
    return this.deps.registry.active();
  }

  public injectedErrorMs(node_id: UUID, now_ms: number): number {
    let sum = 0;
    for (const fault of this.deps.registry.list()) {
      if (fault.node_id !== node_id) continue;
      sum += faultContributionMs(fault, now_ms);
    }
    return sum;
  }

  public async markDetected(fault_id: UUID, at_ms: number, error_ms: number): Promise<void> {
    this.deps.registry.markDetected(fault_id, at_ms, error_ms);
  }

  public stopActive(): Fault[] {
    return this.active().map((fault) => this.stopSync(fault.id));
  }

  /**
   * One lifecycle pass for the existing 1 Hz tick.
   * Deactivates each due target before the registry marks that fault expired.
   * A failed deactivation leaves the fault active.
   */
  public runLifecycle(nowMs: number): Fault[] {
    const expired: Fault[] = [];
    for (const fault of this.deps.registry.dueAt(nowMs)) {
      if (!this.deactivateTarget(fault)) continue;
      const marked = this.deps.registry.markExpired(fault.id, nowMs);
      if (marked) expired.push(marked);
    }
    return expired;
  }

  private requireNode(nodeId: UUID): NodeInfo {
    const node = this.deps.getNodes().find((item) => item.id === nodeId);
    if (!node) throw new Error(`Unknown node ${nodeId}`);
    if (!node.online) throw new Error(`Node ${nodeId} is offline`);
    return node;
  }

  private deactivateTarget(fault: Fault): boolean {
    const node = this.deps.getNodes().find((item) => item.id === fault.node_id);
    if (!node) return false;
    try {
      if (node.kind === 'virtual') {
        this.deps.sim.stopFault(fault.id);
        return true;
      }
      if (node.kind === 'browser') {
        this.deps.sendToNode(node.id, 'fault:clear', fault);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  private stopSync(id: UUID): Fault {
    const existing = this.deps.registry.get(id);
    if (!existing) throw new Error(`Unknown fault ${id}`);
    const stoppedAtMs = this.deps.now();
    const wasActive = existing.status === 'active';
    const stopped = this.deps.registry.stop(id, stoppedAtMs);
    if (wasActive && existing.applies_to === 'sim') this.deps.sim.stopFault(id);
    if (wasActive && existing.applies_to === 'agent_shim') {
      this.deps.sendToNode(existing.node_id, 'fault:clear', stopped);
    }
    return stopped;
  }
}
