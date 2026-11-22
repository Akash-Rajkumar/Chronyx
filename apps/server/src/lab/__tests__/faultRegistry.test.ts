// TEST-FIXTURE
import { describe, expect, it } from 'vitest';
import type { Fault } from '@chronyx/contracts';
import { SOCKET_EVENTS } from '@chronyx/contracts';
import { FaultRegistry } from '../faultRegistry.js';

const START = 1_000_000;

function fault(fields: Partial<Fault> = {}): Fault {
  return {
    id: '10000000-0000-4000-8000-0000000000aa',
    node_id: '11111111-1111-4111-8111-111111111111',
    type: 'clock_step',
    params: { offset_ms: 10, duration_s: 5 },
    started_at_ms: START,
    ends_at_ms: null,
    status: 'active',
    applies_to: 'sim',
    detected_at_ms: null,
    error_at_detect_ms: null,
    detection_latency_s: null,
    ...fields,
  };
}

describe('fault registry expiry', () => {
  it('sets status to expired at the cutoff and emits fault:changed once', () => {
    const events: { event: string; payload: unknown }[] = [];
    const record = fault();
    const registry = new FaultRegistry((event, payload) => {
      events.push({ event, payload });
    }, [record]);

    registry.expireAt(START + 4_999);
    expect(registry.get(record.id)?.status).toBe('active');
    expect(events).toEqual([]);

    registry.expireAt(START + 5_000);
    const expired = registry.get(record.id);
    expect(expired?.status).toBe('expired');
    expect(events).toEqual([{ event: SOCKET_EVENTS.FAULT_CHANGED, payload: expired }]);

    registry.expireAt(START + 9_000);
    expect(events).toHaveLength(1);
    expect(record.status).toBe('active');
  });

  it('expires from the same explicit timestamp on every run', () => {
    const run = () => {
      const events: unknown[] = [];
      const registry = new FaultRegistry((_event, payload) => {
        events.push(payload);
      }, [fault({ ends_at_ms: START + 4_000, params: { offset_ms: 10, duration_s: 2 } })]);
      registry.expireAt(START + 4_000);
      return events;
    };
    expect(run()).toEqual(run());
  });

  it('leaves a stopped fault unchanged and emits nothing', () => {
    const events: unknown[] = [];
    const stopped = fault({ status: 'stopped' });
    const registry = new FaultRegistry((_event, payload) => {
      events.push(payload);
    }, [stopped]);

    registry.expireAt(START + 5_000);
    expect(registry.get(stopped.id)?.status).toBe('stopped');
    expect(events).toEqual([]);
  });

  it('does not emit again for a fault that is already expired', () => {
    const events: unknown[] = [];
    const expired = fault({ status: 'expired' });
    const registry = new FaultRegistry((_event, payload) => {
      events.push(payload);
    }, [expired]);

    registry.expireAt(START + 5_000);
    expect(registry.get(expired.id)?.status).toBe('expired');
    expect(events).toEqual([]);
  });

  it('expires only the active fault when stopped and expired faults share the registry', () => {
    const events: { event: string; payload: unknown }[] = [];
    const stopped = fault({ id: '10000000-0000-4000-8000-0000000000b1', status: 'stopped' });
    const already = fault({ id: '10000000-0000-4000-8000-0000000000b2', status: 'expired' });
    const active = fault({ id: '10000000-0000-4000-8000-0000000000b3', status: 'active' });
    const registry = new FaultRegistry((event, payload) => {
      events.push({ event, payload });
    }, [stopped, already, active]);

    registry.expireAt(START + 5_000);
    const updated = registry.get(active.id);
    expect(registry.get(stopped.id)?.status).toBe('stopped');
    expect(registry.get(already.id)?.status).toBe('expired');
    expect(updated?.status).toBe('expired');
    expect(events).toEqual([{ event: SOCKET_EVENTS.FAULT_CHANGED, payload: updated }]);

    registry.expireAt(START + 9_000);
    expect(events).toHaveLength(1);
  });

  it('returns due copies without mutating the registry or emitting', () => {
    const events: unknown[] = [];
    const active = fault();
    const stopped = fault({ id: '10000000-0000-4000-8000-0000000000b1', status: 'stopped' });
    const expired = fault({ id: '10000000-0000-4000-8000-0000000000b2', status: 'expired' });
    const open = fault({
      id: '10000000-0000-4000-8000-0000000000b4',
      params: { offset_ms: 1 },
      ends_at_ms: null,
    });
    const registry = new FaultRegistry((_event, payload) => {
      events.push(payload);
    }, [active, stopped, expired, open]);
    const before = registry.list();

    const early = registry.dueAt(START + 4_999);
    const due = registry.dueAt(START + 5_000);
    expect(early).toEqual([]);
    expect(due).toEqual([active]);
    expect(due[0]).not.toBe(active);
    if (due[0]) {
      due[0].status = 'expired';
      due[0].params.offset_ms = 99;
    }
    expect(registry.list()).toEqual(before);
    expect(events).toEqual([]);
  });

  it('rejects missing, inactive, and not-yet-due faults without emitting', () => {
    const events: unknown[] = [];
    const active = fault();
    const stopped = fault({ id: '10000000-0000-4000-8000-0000000000b1', status: 'stopped' });
    const registry = new FaultRegistry((_event, payload) => {
      events.push(payload);
    }, [active, stopped]);

    expect(registry.markExpired('10000000-0000-4000-8000-0000000000ff', START + 5_000)).toBeUndefined();
    expect(registry.markExpired(stopped.id, START + 5_000)).toBeUndefined();
    expect(registry.markExpired(active.id, START + 4_999)).toBeUndefined();
    expect(registry.get(active.id)?.status).toBe('active');
    expect(registry.get(stopped.id)?.status).toBe('stopped');
    expect(events).toEqual([]);
  });

  it('expires one due fault once and leaves ends_at_ms unchanged', () => {
    const events: { event: string; payload: unknown }[] = [];
    const record = fault({ ends_at_ms: START + 5_000 });
    const registry = new FaultRegistry((event, payload) => {
      events.push({ event, payload });
    }, [record]);

    const updated = registry.markExpired(record.id, START + 5_000);
    expect(updated).toEqual({ ...record, status: 'expired', ends_at_ms: START + 5_000 });
    expect(events).toEqual([{ event: SOCKET_EVENTS.FAULT_CHANGED, payload: updated }]);

    expect(registry.markExpired(record.id, START + 9_000)).toBeUndefined();
    expect(events).toHaveLength(1);
    expect(registry.get(record.id)?.ends_at_ms).toBe(START + 5_000);
  });

  it('updates only the three detection fields and leaves the other fault unchanged', () => {
    const events: { event: string; payload: unknown }[] = [];
    const target = fault({ id: '10000000-0000-4000-8000-0000000000aa' });
    const other = fault({
      id: '10000000-0000-4000-8000-0000000000bb',
      node_id: '22222222-2222-4222-8222-222222222222',
      params: { offset_ms: 3 },
    });
    const registry = new FaultRegistry((event, payload) => {
      events.push({ event, payload });
    }, [target, other]);
    const updated = registry.markDetected(target.id, START + 4_000, 10);
    expect(updated).toEqual({
      ...target,
      detected_at_ms: START + 4_000,
      error_at_detect_ms: 10,
      detection_latency_s: 4,
    });
    expect(registry.get(other.id)).toEqual(other);
    expect(events).toEqual([{ event: SOCKET_EVENTS.FAULT_CHANGED, payload: updated }]);
  });
});
