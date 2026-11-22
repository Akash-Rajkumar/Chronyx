// TEST-FIXTURE
import { describe, expect, it } from 'vitest';
import type { Fault, ISim, NodeInfo, UUID } from '@chronyx/contracts';
import { SOCKET_EVENTS } from '@chronyx/contracts';
import type { IFaultService } from '../../ctx.js';
import { FaultRegistry } from '../faultRegistry.js';
import { LabFaultService } from '../faultService.js';

const VIRTUAL = '11111111-1111-4111-8111-111111111111';
const BROWSER = '22222222-2222-4222-8222-222222222222';
const OTHER = '33333333-3333-4333-8333-333333333333';
const FAULT_ID = '10000000-0000-4000-8000-0000000000aa';
const SECOND_ID = '10000000-0000-4000-8000-0000000000bb';

function node(id: UUID, kind: NodeInfo['kind'], online = true): NodeInfo {
  return {
    id,
    name: kind === 'virtual' ? 'V-Alpha' : 'Browser',
    kind,
    public_key: 'AA==',
    created_at: '1970-01-01T00:00:00.000Z',
    last_seen_at: null,
    online,
  };
}

function harness(nodes: NodeInfo[] = [node(VIRTUAL, 'virtual'), node(BROWSER, 'browser'), node(OTHER, 'virtual')]) {
  const events: { event: string; payload: unknown }[] = [];
  const applied: Fault[] = [];
  const stopped: UUID[] = [];
  const sent: { nodeId: UUID; event: 'fault:apply' | 'fault:clear'; payload: unknown }[] = [];
  const transport = {
    send(nodeId: UUID, event: 'fault:apply' | 'fault:clear', payload: unknown): void {
      sent.push({ nodeId, event, payload });
    },
  };
  const ids = [FAULT_ID, SECOND_ID];
  let nowMs = 1_000_000;
  const registry = new FaultRegistry((event, payload) => {
    events.push({ event, payload });
  });
  const sim: ISim = {
    addVirtualNode: async () => {
      throw new Error('unused');
    },
    step: async () => [],
    applyFault: (fault) => {
      applied.push(fault);
    },
    stopFault: (id) => {
      stopped.push(id);
    },
    faultOffsetMs: () => 0,
  };
  const faults = new LabFaultService({
    registry,
    now: () => nowMs,
    getNodes: () => nodes,
    sim,
    sendToNode: (nodeId, event, payload) => {
      transport.send(nodeId, event, payload);
    },
    emit: (event, payload) => {
      events.push({ event, payload });
    },
    newId: () => ids.shift() ?? '10000000-0000-4000-8000-0000000000cc',
  });
  return {
    faults,
    registry,
    events,
    applied,
    stopped,
    sent,
    sim,
    transport,
    setNow: (value: number) => {
      nowMs = value;
    },
    nodes,
  };
}

describe('lab fault service', () => {
  it('implements IFaultService', () => {
    const { faults } = harness();
    const typed: IFaultService = faults;
    expect(typed.active()).toEqual([]);
  });

  it('creates exactly one registry record from async start', async () => {
    const { faults, registry } = harness();
    const created = await faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 10 } });
    expect(registry.list()).toEqual([created]);
    expect(registry.active()).toHaveLength(1);
  });

  it('rejects an unknown node', async () => {
    const { faults, registry } = harness();
    await expect(
      faults.start({ type: 'clock_step', node_id: '44444444-4444-4444-8444-444444444444', params: {} }),
    ).rejects.toThrow(/Unknown node/);
    expect(registry.list()).toEqual([]);
  });

  it('rejects an offline node', async () => {
    const { faults, registry } = harness([node(VIRTUAL, 'virtual', false)]);
    await expect(faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 10 } })).rejects.toThrow(
      /offline/,
    );
    expect(registry.list()).toEqual([]);
  });

  it('invokes sim.applyFault for a virtual node', async () => {
    const { faults, applied, sent } = harness();
    const created = await faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 10 } });
    expect(created.applies_to).toBe('sim');
    expect(applied).toEqual([created]);
    expect(sent).toEqual([]);
  });

  it('invokes targeted fault:apply for a browser node', async () => {
    const { faults, applied, sent } = harness();
    const created = await faults.start({ type: 'clock_step', node_id: BROWSER, params: { offset_ms: 4 } });
    expect(created.applies_to).toBe('agent_shim');
    expect(sent).toEqual([{ nodeId: BROWSER, event: 'fault:apply', payload: created }]);
    expect(applied).toEqual([]);
  });

  it('updates only the stopped record', async () => {
    const { faults, registry } = harness();
    const first = await faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 10 } });
    const second = await faults.start({ type: 'clock_step', node_id: OTHER, params: { offset_ms: 3 } });
    const stopped = await faults.stop(first.id);
    expect(stopped.id).toBe(first.id);
    expect(stopped.status).toBe('stopped');
    expect(registry.get(second.id)?.status).toBe('active');
  });

  it('invokes targeted fault:clear when a browser fault stops', async () => {
    const { faults, sent, stopped } = harness();
    const created = await faults.start({ type: 'clock_step', node_id: BROWSER, params: { offset_ms: 4 } });
    const result = await faults.stop(created.id);
    expect(sent[1]).toEqual({ nodeId: BROWSER, event: 'fault:clear', payload: result });
    expect(stopped).toEqual([]);
  });

  it('takes start and stop timestamps from the injected clock', async () => {
    const { faults, setNow } = harness();
    setNow(5_000);
    const created = await faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 10 } });
    expect(created.started_at_ms).toBe(5_000);
    setNow(8_000);
    const stopped = await faults.stop(created.id);
    expect(stopped.started_at_ms).toBe(5_000);
    expect(stopped.ends_at_ms).toBe(8_000);
  });

  it('adds active fault effects for one node and ignores the other node', async () => {
    const { faults } = harness();
    await faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 10 } });
    await faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 4 } });
    await faults.start({ type: 'clock_step', node_id: OTHER, params: { offset_ms: 7 } });
    expect(faults.injectedErrorMs(VIRTUAL, 1_000_000)).toBe(14);
    expect(faults.injectedErrorMs(OTHER, 1_000_000)).toBe(7);
  });

  it('honours the start instant and the exclusive expiry boundary', async () => {
    const { faults, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: VIRTUAL,
      params: { offset_ms: 10, duration_s: 5 },
    });
    expect(created.ends_at_ms).toBe(1_005_000);
    expect(faults.injectedErrorMs(VIRTUAL, 999_999)).toBe(0);
    expect(faults.injectedErrorMs(VIRTUAL, 1_000_000)).toBe(10);
    expect(faults.injectedErrorMs(VIRTUAL, 1_004_999)).toBe(10);
    expect(faults.injectedErrorMs(VIRTUAL, 1_005_000)).toBe(0);
  });

  it('updates only the three detection fields', async () => {
    const { faults, registry } = harness();
    const created = await faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 10 } });
    await faults.markDetected(created.id, 1_004_000, 10);
    const updated = registry.get(created.id);
    expect(updated).toEqual({
      ...created,
      detected_at_ms: 1_004_000,
      error_at_detect_ms: 10,
      detection_latency_s: 4,
    });
  });

  it('leaves an unrelated fault unchanged when one fault is marked detected', async () => {
    const { faults, registry } = harness();
    const first = await faults.start({ type: 'clock_step', node_id: VIRTUAL, params: { offset_ms: 10 } });
    const second = await faults.start({ type: 'clock_ramp', node_id: OTHER, params: { rate_ms_per_min: 0.5 } });
    await faults.markDetected(first.id, 1_002_000, 1);
    expect(registry.get(second.id)).toEqual(second);
  });

  it('stops a virtual fault before the registry expires it', async () => {
    const { faults, registry, sim, stopped, sent, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: VIRTUAL,
      params: { offset_ms: 10, duration_s: 5 },
    });
    const seen: string[] = [];
    const originalEnds = registry.get(created.id)?.ends_at_ms;
    sim.stopFault = (id) => {
      seen.push(registry.get(id)?.status ?? 'missing');
      stopped.push(id);
    };
    setNow(1_005_000);
    const expired = faults.runLifecycle(1_005_000);
    expect(seen).toEqual(['active']);
    expect(stopped).toEqual([created.id]);
    expect(sent.filter((message) => message.event === 'fault:clear')).toEqual([]);
    expect(expired.map((fault) => fault.status)).toEqual(['expired']);
    expect(registry.get(created.id)?.ends_at_ms).toBe(originalEnds);
  });

  it('clears only the browser node before the registry expires its fault', async () => {
    const { faults, registry, transport, sent, stopped, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: BROWSER,
      params: { offset_ms: 4, duration_s: 5 },
    });
    const seen: string[] = [];
    const originalSend = transport.send.bind(transport);
    transport.send = (nodeId, event, payload) => {
      if (event === 'fault:clear') seen.push(registry.get(created.id)?.status ?? 'missing');
      originalSend(nodeId, event, payload);
    };
    setNow(1_005_000);
    faults.runLifecycle(1_005_000);
    expect(seen).toEqual(['active']);
    expect(sent.filter((message) => message.event === 'fault:clear')).toEqual([
      { nodeId: BROWSER, event: 'fault:clear', payload: expect.objectContaining({ id: created.id, status: 'active' }) },
    ]);
    expect(stopped).toEqual([]);
    expect(registry.get(created.id)?.status).toBe('expired');
  });

  it('leaves a virtual fault active when deactivation fails and expires it on retry', async () => {
    const { faults, registry, sim, events, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: VIRTUAL,
      params: { offset_ms: 10, duration_s: 5 },
    });
    let fail = true;
    sim.stopFault = () => {
      if (fail) throw new Error('sim unavailable');
    };
    setNow(1_005_000);
    const before = events.length;
    expect(faults.runLifecycle(1_005_000)).toEqual([]);
    expect(registry.get(created.id)?.status).toBe('active');
    expect(events.slice(before)).toEqual([]);
    fail = false;
    const expired = faults.runLifecycle(1_005_000);
    expect(expired).toHaveLength(1);
    expect(registry.get(created.id)?.status).toBe('expired');
  });

  it('leaves a browser fault active when clear fails and expires it on retry', async () => {
    const { faults, registry, transport, sent, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: BROWSER,
      params: { offset_ms: 4, duration_s: 5 },
    });
    let fail = true;
    const originalSend = transport.send.bind(transport);
    transport.send = (nodeId, event, payload) => {
      if (event === 'fault:clear' && fail) throw new Error('node unavailable');
      originalSend(nodeId, event, payload);
    };
    setNow(1_005_000);
    expect(faults.runLifecycle(1_005_000)).toEqual([]);
    expect(registry.get(created.id)?.status).toBe('active');
    expect(sent.filter((message) => message.event === 'fault:clear')).toEqual([]);
    fail = false;
    faults.runLifecycle(1_005_000);
    expect(sent.filter((message) => message.event === 'fault:clear')).toEqual([
      { nodeId: BROWSER, event: 'fault:clear', payload: expect.objectContaining({ id: created.id }) },
    ]);
    expect(registry.get(created.id)?.status).toBe('expired');
  });

  it('does not call markExpired before deactivation succeeds', async () => {
    const { faults, registry, sim, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: VIRTUAL,
      params: { offset_ms: 10, duration_s: 5 },
    });
    const calls: string[] = [];
    const markExpired = registry.markExpired.bind(registry);
    registry.markExpired = (id, nowMs) => {
      calls.push('markExpired');
      return markExpired(id, nowMs);
    };
    let fail = true;
    sim.stopFault = () => {
      calls.push('stopFault');
      if (fail) throw new Error('sim unavailable');
    };
    setNow(1_005_000);
    expect(faults.runLifecycle(1_005_000)).toEqual([]);
    expect(calls).toEqual(['stopFault']);
    expect(registry.get(created.id)?.status).toBe('active');
    fail = false;
    faults.runLifecycle(1_005_000);
    expect(calls).toEqual(['stopFault', 'stopFault', 'markExpired']);
    expect(registry.get(created.id)?.status).toBe('expired');
  });

  it('leaves a fault active when its target node is missing', async () => {
    const { faults, registry, nodes, sim, sent, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: VIRTUAL,
      params: { offset_ms: 10, duration_s: 5 },
    });
    const index = nodes.findIndex((item) => item.id === VIRTUAL);
    nodes.splice(index, 1);
    let stopped = false;
    sim.stopFault = () => {
      stopped = true;
    };
    setNow(1_005_000);
    expect(faults.runLifecycle(1_005_000)).toEqual([]);
    expect(stopped).toBe(false);
    expect(sent.filter((message) => message.event === 'fault:clear')).toEqual([]);
    expect(registry.get(created.id)?.status).toBe('active');
  });

  it('leaves a fault active when the target kind is unknown', async () => {
    const { faults, registry, nodes, sim, sent, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: VIRTUAL,
      params: { offset_ms: 10, duration_s: 5 },
    });
    const target = nodes.find((item) => item.id === VIRTUAL);
    if (!target) throw new Error('missing target');
    (target as { kind: string }).kind = 'relay';
    let stopped = false;
    sim.stopFault = () => {
      stopped = true;
    };
    setNow(1_005_000);
    expect(faults.runLifecycle(1_005_000)).toEqual([]);
    expect(stopped).toBe(false);
    expect(sent.filter((message) => message.event === 'fault:clear')).toEqual([]);
    expect(registry.get(created.id)?.status).toBe('active');
  });

  it('does not clear an unrelated node or fault', async () => {
    const { faults, registry, stopped, sent, setNow } = harness();
    setNow(1_000_000);
    const virtual = await faults.start({
      type: 'clock_step',
      node_id: VIRTUAL,
      params: { offset_ms: 10, duration_s: 5 },
    });
    const browser = await faults.start({
      type: 'clock_step',
      node_id: BROWSER,
      params: { offset_ms: 4, duration_s: 5 },
    });
    const other = await faults.start({
      type: 'clock_step',
      node_id: OTHER,
      params: { offset_ms: 7 },
    });
    setNow(1_005_000);
    faults.runLifecycle(1_005_000);
    expect(stopped).toEqual([virtual.id]);
    expect(sent.filter((message) => message.event === 'fault:clear')).toEqual([
      { nodeId: BROWSER, event: 'fault:clear', payload: expect.objectContaining({ id: browser.id }) },
    ]);
    expect(registry.get(other.id)?.status).toBe('active');
    expect(registry.get(virtual.id)?.status).toBe('expired');
    expect(registry.get(browser.id)?.status).toBe('expired');
  });

  it('expires an active fault once through the registry', async () => {
    const { faults, registry, events, setNow } = harness();
    setNow(1_000_000);
    const created = await faults.start({
      type: 'clock_step',
      node_id: VIRTUAL,
      params: { offset_ms: 10, duration_s: 5 },
    });
    const before = events.length;
    registry.expireAt(1_004_999);
    expect(registry.get(created.id)?.status).toBe('active');
    registry.expireAt(1_005_000);
    expect(registry.get(created.id)?.status).toBe('expired');
    registry.expireAt(1_009_000);
    const expiryEvents = events.slice(before).filter((event) => {
      const payload = event.payload as Fault;
      return event.event === SOCKET_EVENTS.FAULT_CHANGED && payload.status === 'expired';
    });
    expect(expiryEvents).toHaveLength(1);
  });
});
