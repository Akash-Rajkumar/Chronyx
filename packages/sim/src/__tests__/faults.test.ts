// TEST-FIXTURE
import { describe, expect, it } from 'vitest';
import type { Fault, UUID } from '@chronyx/contracts';
import { createSim } from '../index.js';
import { faultContributionMs } from '../faults.js';

const NODE = '11111111-1111-4111-8111-111111111111';
const START = 1_000_000;

function fault(fields: Pick<Fault, 'type' | 'params'> & Partial<Fault>): Fault {
  return {
    id: '10000000-0000-4000-8000-0000000000aa',
    node_id: NODE,
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

describe('deterministic fault model', () => {
  it('calculates a clock_step from offset_ms', () => {
    const step = fault({ type: 'clock_step', params: { offset_ms: 10 } });
    expect(faultContributionMs(step, START + 5_000)).toBe(10);
  });

  it('calculates a clock_ramp from rate only', () => {
    const ramp = fault({ type: 'clock_ramp', params: { rate_ms_per_min: 0.5 } });
    const minutes = 2;
    expect(faultContributionMs(ramp, START + minutes * 60_000)).toBeCloseTo(0.5 * minutes, 12);
  });

  it('calculates a clock_ramp with acceleration', () => {
    const rate = 0.5;
    const accel = 0.1;
    const minutes = 1.5;
    const ramp = fault({
      type: 'clock_ramp',
      params: { rate_ms_per_min: rate, accel_ms_per_min2: accel },
    });
    const expected = rate * minutes + 0.5 * accel * minutes * minutes;
    expect(faultContributionMs(ramp, START + minutes * 60_000)).toBeCloseTo(expected, 12);
  });

  it('treats missing optional parameters as zero', () => {
    const step = fault({ type: 'clock_step', params: {} });
    const ramp = fault({ type: 'clock_ramp', params: {} });
    expect(faultContributionMs(step, START + 1_000)).toBe(0);
    expect(faultContributionMs(ramp, START + 60_000)).toBe(0);
  });

  it('contributes zero before the start', () => {
    const step = fault({ type: 'clock_step', params: { offset_ms: 10 } });
    expect(faultContributionMs(step, START - 1)).toBe(0);
  });

  it('includes the exact start instant', () => {
    const step = fault({ type: 'clock_step', params: { offset_ms: 10 } });
    const ramp = fault({ type: 'clock_ramp', params: { rate_ms_per_min: 6 } });
    expect(faultContributionMs(step, START)).toBe(10);
    expect(faultContributionMs(ramp, START)).toBe(0);
  });

  it('excludes the exact ends_at_ms instant', () => {
    const ends = START + 4_000;
    const step = fault({ type: 'clock_step', params: { offset_ms: 10 }, ends_at_ms: ends });
    expect(faultContributionMs(step, ends - 1)).toBe(10);
    expect(faultContributionMs(step, ends)).toBe(0);
  });

  it('excludes the exact duration_s instant', () => {
    const step = fault({ type: 'clock_step', params: { offset_ms: 10, duration_s: 5 } });
    const cutoff = START + 5_000;
    expect(faultContributionMs(step, cutoff - 1)).toBe(10);
    expect(faultContributionMs(step, cutoff)).toBe(0);
  });

  it('lets ends_at_ms override a conflicting duration_s', () => {
    const endsLater = fault({
      type: 'clock_step',
      params: { offset_ms: 10, duration_s: 2 },
      ends_at_ms: START + 9_000,
    });
    expect(faultContributionMs(endsLater, START + 2_000)).toBe(10);
    expect(faultContributionMs(endsLater, START + 8_999)).toBe(10);
    expect(faultContributionMs(endsLater, START + 9_000)).toBe(0);

    const endsEarlier = fault({
      type: 'clock_step',
      params: { offset_ms: 10, duration_s: 10 },
      ends_at_ms: START + 4_000,
    });
    expect(faultContributionMs(endsEarlier, START + 3_999)).toBe(10);
    expect(faultContributionMs(endsEarlier, START + 4_000)).toBe(0);
  });

  it('uses duration_s only when ends_at_ms is null', () => {
    const step = fault({
      type: 'clock_step',
      params: { offset_ms: 10, duration_s: 5 },
      ends_at_ms: null,
    });
    expect(faultContributionMs(step, START + 4_999)).toBe(10);
    expect(faultContributionMs(step, START + 5_000)).toBe(0);
  });

  it('stays active when ends_at_ms and duration_s are both absent', () => {
    const step = fault({ type: 'clock_step', params: { offset_ms: 10 }, ends_at_ms: null });
    expect(faultContributionMs(step, START + 86_400_000)).toBe(10);
  });

  it('does not change stored status when the cutoff has passed', async () => {
    const step = fault({
      type: 'clock_step',
      params: { offset_ms: 10 },
      ends_at_ms: START + 1_000,
    });
    const sim = await createSim(4);
    const nodeId = (await sim.addVirtualNode('V-Hotel')).id;
    sim.applyFault({ ...step, id: '10000000-0000-4000-8000-0000000000ff', node_id: nodeId });
    expect(sim.faultOffsetMs(nodeId, START + 1_000)).toBe(0);
    expect(sim.faultOffsetMs(nodeId, START + 500)).toBe(10);
    expect(step.status).toBe('active');
  });

  it('contributes zero for a stopped fault', async () => {
    const step = fault({ type: 'clock_step', params: { offset_ms: 10 }, status: 'stopped' });
    expect(faultContributionMs(step, START + 1_000)).toBe(0);

    const sim = await createSim(1);
    const nodeId: UUID = (await sim.addVirtualNode('V-Delta')).id;
    const id = '10000000-0000-4000-8000-0000000000bb';
    sim.applyFault(fault({ id, node_id: nodeId, type: 'clock_step', params: { offset_ms: 10 } }));
    expect(sim.faultOffsetMs(nodeId, START + 1_000)).toBe(10);
    sim.stopFault(id);
    expect(sim.faultOffsetMs(nodeId, START + 1_000)).toBe(0);
  });

  it('contributes zero for a stored expired fault', () => {
    const step = fault({ type: 'clock_step', params: { offset_ms: 10 }, status: 'expired' });
    expect(faultContributionMs(step, START + 1_000)).toBe(0);
    expect(step.status).toBe('expired');
  });

  it('ignores an agent_shim fault in the simulator', async () => {
    const sim = await createSim(2);
    const nodeId = (await sim.addVirtualNode('V-Echo')).id;
    sim.applyFault(
      fault({
        id: '10000000-0000-4000-8000-0000000000cc',
        node_id: nodeId,
        type: 'clock_step',
        params: { offset_ms: 10 },
        applies_to: 'agent_shim',
      }),
    );
    expect(sim.faultOffsetMs(nodeId, START + 1_000)).toBe(0);
  });

  it('adds multiple fault contributions for one node', async () => {
    const sim = await createSim(3);
    const nodeId = (await sim.addVirtualNode('V-Foxtrot')).id;
    const minutes = 2;
    const now = START + minutes * 60_000;
    sim.applyFault(
      fault({
        id: '10000000-0000-4000-8000-0000000000d1',
        node_id: nodeId,
        type: 'clock_step',
        params: { offset_ms: 10 },
      }),
    );
    sim.applyFault(
      fault({
        id: '10000000-0000-4000-8000-0000000000d2',
        node_id: nodeId,
        type: 'clock_ramp',
        params: { rate_ms_per_min: 0.5 },
      }),
    );
    sim.applyFault(
      fault({
        id: '10000000-0000-4000-8000-0000000000d3',
        node_id: nodeId,
        type: 'clock_step',
        params: { offset_ms: 4 },
        status: 'stopped',
      }),
    );
    expect(sim.faultOffsetMs(nodeId, now)).toBeCloseTo(10 + 0.5 * minutes, 12);
  });

  it('returns the same offset for identical inputs', async () => {
    const ramp = fault({
      type: 'clock_ramp',
      params: { rate_ms_per_min: 0.2, accel_ms_per_min2: 0.05 },
    });
    const now = START + 90_000;
    expect(faultContributionMs(ramp, now)).toBe(faultContributionMs({ ...ramp, params: { ...ramp.params } }, now));

    const run = async () => {
      const sim = await createSim(9);
      const nodeId = (await sim.addVirtualNode('V-Golf')).id;
      sim.applyFault(
        fault({
          id: '10000000-0000-4000-8000-0000000000ee',
          node_id: nodeId,
          type: 'clock_step',
          params: { offset_ms: 10 },
        }),
      );
      return sim.faultOffsetMs(nodeId, now);
    };
    expect(await run()).toBe(await run());
  });
});
