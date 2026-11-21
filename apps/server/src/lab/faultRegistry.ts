import type { Fault, UUID } from '@chronyx/contracts';
import { SOCKET_EVENTS } from '@chronyx/contracts';
import { faultCutoffMs } from '@chronyx/sim';

function copyFault(fault: Fault): Fault {
  return { ...fault, params: { ...fault.params } };
}

/**
 * Stores faults and expires them at an explicit timestamp.
 * IFaultService has no expiry method. LabFaultService.runLifecycle performs
 * target deactivation before markExpired. The 1 Hz orchestrator does not call it yet.
 */
export class FaultRegistry {
  private readonly byId = new Map<UUID, Fault>();

  public constructor(
    private readonly emit: (event: string, payload: unknown) => void,
    faults: readonly Fault[] = [],
  ) {
    for (const fault of faults) {
      this.byId.set(fault.id, copyFault(fault));
    }
  }

  public get(id: UUID): Fault | undefined {
    const fault = this.byId.get(id);
    return fault === undefined ? undefined : copyFault(fault);
  }

  public add(fault: Fault): void {
    this.byId.set(fault.id, copyFault(fault));
  }

  public active(): Fault[] {
    const faults: Fault[] = [];
    for (const fault of this.byId.values()) {
      if (fault.status === 'active') faults.push(copyFault(fault));
    }
    return faults;
  }

  public list(): Fault[] {
    return [...this.byId.values()].map((fault) => copyFault(fault));
  }

  /**
   * Updates only the three detection fields.
   * detection_latency_s is seconds from started_at_ms to atMs.
   */
  public markDetected(id: UUID, atMs: number, errorMs: number): Fault {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new Error(`Unknown fault ${id}`);
    }
    const updated = copyFault(existing);
    updated.detected_at_ms = atMs;
    updated.error_at_detect_ms = errorMs;
    updated.detection_latency_s = (atMs - existing.started_at_ms) / 1000;
    this.byId.set(id, updated);
    const payload = copyFault(updated);
    this.emit(SOCKET_EVENTS.FAULT_CHANGED, payload);
    return payload;
  }

  /** Marks an active fault stopped and emits fault:changed once. */
  public stop(id: UUID, stoppedAtMs?: number): Fault {
    const existing = this.byId.get(id);
    if (!existing) {
      throw new Error(`Unknown fault ${id}`);
    }
    if (existing.status !== 'active') {
      return copyFault(existing);
    }
    const stopped = copyFault(existing);
    stopped.status = 'stopped';
    if (stoppedAtMs !== undefined) stopped.ends_at_ms = stoppedAtMs;
    this.byId.set(id, stopped);
    const payload = copyFault(stopped);
    this.emit(SOCKET_EVENTS.FAULT_CHANGED, payload);
    return payload;
  }

  /** Copies of active faults whose cutoff has been reached. Does not mutate or emit. */
  public dueAt(nowMs: number): Fault[] {
    const due: Fault[] = [];
    for (const fault of this.byId.values()) {
      if (fault.status !== 'active') continue;
      const cutoff = faultCutoffMs(fault);
      if (cutoff == null || nowMs < cutoff) continue;
      due.push(copyFault(fault));
    }
    return due;
  }

  /**
   * Expires one active fault that is already due.
   * Missing, inactive, and not-yet-due faults are left unchanged and emit nothing.
   */
  public markExpired(id: UUID, nowMs: number): Fault | undefined {
    const existing = this.byId.get(id);
    if (!existing || existing.status !== 'active') return undefined;
    const cutoff = faultCutoffMs(existing);
    if (cutoff == null || nowMs < cutoff) return undefined;
    const expired = copyFault(existing);
    expired.status = 'expired';
    this.byId.set(id, expired);
    const payload = copyFault(expired);
    this.emit(SOCKET_EVENTS.FAULT_CHANGED, payload);
    return payload;
  }

  /** Marks every fault due at nowMs as expired. Each transition emits fault:changed once. */
  public expireAt(nowMs: number): void {
    for (const fault of this.dueAt(nowMs)) {
      this.markExpired(fault.id, nowMs);
    }
  }
}
