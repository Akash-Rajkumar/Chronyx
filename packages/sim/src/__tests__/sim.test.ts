// TEST-FIXTURE
import { describe, expect, it } from 'vitest';
import type { Exchange, Fault, UUID } from '@chronyx/contracts';
import { GENESIS_PREV_HASH } from '@chronyx/contracts';
import { computeHeartbeatHash, verifyHeartbeat, verifyHash } from '@chronyx/crypto';
import { createSim } from '../index.js';

function peerOffsetMs(exchange: Exchange): number {
  return ((exchange.t1 - exchange.t2) + (exchange.t4 - exchange.t3)) / 2;
}

function makeFault(
  fields: Pick<Fault, 'id' | 'type' | 'node_id' | 'params' | 'started_at_ms'> & Partial<Fault>,
): Fault {
  return {
    ends_at_ms: null,
    status: 'active',
    applies_to: 'sim',
    detected_at_ms: null,
    error_at_detect_ms: null,
    detection_latency_s: null,
    ...fields,
  };
}

describe('simulator core', () => {
  it('creates exactly three default virtual nodes', async () => {
    const sim = await createSim(42);
    const out = await sim.step(1_700_000_000_000);
    expect(out).toHaveLength(3);
    expect(out.map((row) => row.node.name)).toEqual(['V-Alpha', 'V-Bravo', 'V-Charlie']);
    expect(new Set(out.map((row) => row.node.id)).size).toBe(3);
    for (const row of out) {
      expect(row.node.kind).toBe('virtual');
      expect(row.node.online).toBe(true);
    }
  });

  it('shows a +10 ms clock_step in peer offset on the next step', async () => {
    const sim = await createSim(42);
    const t0 = 60_000;
    const before = await sim.step(t0);
    const alpha = before[0];
    if (!alpha) throw new Error('missing V-Alpha');
    const nodeId = alpha.node.id;
    const beforeOffset = peerOffsetMs(alpha.heartbeat.exchange.at(-1)!);

    const faultId = '10000000-0000-4000-8000-000000000010';
    sim.applyFault(
      makeFault({
        id: faultId,
        type: 'clock_step',
        node_id: nodeId,
        params: { offset_ms: 10 },
        started_at_ms: t0,
      }),
    );

    const t1 = t0 + 1000;
    const after = await sim.step(t1);
    const stepped = after.find((row) => row.node.id === nodeId);
    if (!stepped) throw new Error('missing stepped node');
    const afterOffset = peerOffsetMs(stepped.heartbeat.exchange.at(-1)!);

    expect(sim.faultOffsetMs(nodeId, t1)).toBe(10);
    expect(Math.abs(afterOffset - beforeOffset - 10)).toBeLessThan(3);
    expect(Math.abs(afterOffset - 10)).toBeLessThan(3);
  });

  it('follows the clock_ramp formula', async () => {
    const sim = await createSim(7);
    const nodeId = (await sim.step(0))[1]?.node.id;
    if (!nodeId) throw new Error('missing V-Bravo');
    const started = 5_000_000;
    const rate = 0.5;
    const accel = 0.1;
    sim.applyFault(
      makeFault({
        id: '10000000-0000-4000-8000-000000000011',
        type: 'clock_ramp',
        node_id: nodeId,
        params: { rate_ms_per_min: rate, accel_ms_per_min2: accel },
        started_at_ms: started,
      }),
    );

    expect(sim.faultOffsetMs(nodeId, started - 1)).toBe(0);
    expect(sim.faultOffsetMs(nodeId, started)).toBe(0);

    const elapsedMs = 90_000;
    const now = started + elapsedMs;
    const minutes = elapsedMs / 60_000;
    const expected = rate * minutes + 0.5 * accel * minutes * minutes;
    expect(sim.faultOffsetMs(nodeId, now)).toBeCloseTo(expected, 12);
  });

  it('reproduces identical results for the same seed', async () => {
    const run = async (seed: number) => {
      const sim = await createSim(seed);
      return [await sim.step(1_234_567.5), await sim.step(1_235_567.5)];
    };
    expect(await run(99)).toEqual(await run(99));
    expect(await run(99)).not.toEqual(await run(100));
  });

  it('emits heartbeats with valid hashes, signatures and a hash chain', async () => {
    const sim = await createSim(42);
    const t0 = 10_000;
    const first = await sim.step(t0);
    const second = await sim.step(t0 + 1000);

    for (let i = 0; i < first.length; i += 1) {
      const a = first[i];
      const b = second[i];
      if (!a || !b) throw new Error('missing node output');

      const { hash: hashA, sig: sigA, ...bodyA } = a.heartbeat;
      expect(hashA).toBe(computeHeartbeatHash(bodyA));
      expect(a.heartbeat.seq).toBe(0);
      expect(await verifyHash(hashA, sigA, a.node.public_key)).toBe(true);
      expect(await verifyHeartbeat(a.heartbeat, a.node.public_key, 0, bodyA.prev_hash)).toEqual({
        ok: true,
      });

      const { hash: hashB, sig: sigB, ...bodyB } = b.heartbeat;
      expect(hashB).toBe(computeHeartbeatHash(bodyB));
      expect(b.heartbeat.seq).toBe(1);
      expect(b.heartbeat.prev_hash).toBe(hashA);
      expect(await verifyHash(hashB, sigB, b.node.public_key)).toBe(true);
      expect(await verifyHeartbeat(b.heartbeat, b.node.public_key, 1, hashA)).toEqual({ ok: true });
    }
  });

  it('matches signed timing from an unsigned step and does not emit a signature', async () => {
    const signed = await createSim(42);
    const unsigned = await createSim(42);
    const t0 = 1_700_000_000_000;
    const signedOut = await signed.step(t0);
    const unsignedOut = unsigned.stepUnsigned(t0);
    expect(unsignedOut).toHaveLength(signedOut.length);
    for (let index = 0; index < signedOut.length; index += 1) {
      const signedRow = signedOut[index];
      const unsignedRow = unsignedOut[index];
      if (!signedRow || !unsignedRow) throw new Error('missing node output');
      const latest = signedRow.heartbeat.exchange.at(-1);
      if (!latest) throw new Error('missing exchange');
      const peerOffsetMs = ((latest.t1 - latest.t2) + (latest.t4 - latest.t3)) / 2;
      expect(unsignedRow.node_id).toBe(signedRow.node.id);
      expect(unsignedRow.peer_offset_ms).toBe(peerOffsetMs);
      expect(unsignedRow.osc_residual_ms).toBe(signedRow.heartbeat.osc_residual_ms);
      expect(unsignedRow.gnss_resid_ms).toBe(signedRow.gnss_resid_ms);
      expect(unsignedRow.camera_resid_ms).toBe(signedRow.camera_resid_ms);
      expect(unsignedRow.health).toEqual(signedRow.heartbeat.health);
      expect(unsignedRow).not.toHaveProperty('hash');
      expect(unsignedRow).not.toHaveProperty('sig');
    }
    const signedNext = await signed.step(t0 + 1000);
    const unsignedNext = unsigned.stepUnsigned(t0 + 1000);
    expect(unsignedNext[0]?.gnss_resid_ms).toBe(signedNext[0]?.gnss_resid_ms);
    expect(unsignedNext[0]?.camera_resid_ms).toBe(signedNext[0]?.camera_resid_ms);
  });

  it('keeps a later signed step independent of unsigned steps on the same simulator', async () => {
    const mixed = await createSim(42);
    const clean = await createSim(42);
    const firstUnsigned = mixed.stepUnsigned(10_000);
    const secondUnsigned = mixed.stepUnsigned(11_000);
    expect(secondUnsigned).not.toEqual(firstUnsigned);

    const repeatedA = await createSim(7);
    const repeatedB = await createSim(7);
    expect(repeatedA.stepUnsigned(20_000)).toEqual(repeatedB.stepUnsigned(20_000));
    expect(repeatedA.stepUnsigned(21_000)).toEqual(repeatedB.stepUnsigned(21_000));

    const mixedSigned = await mixed.step(30_000);
    const cleanSigned = await clean.step(30_000);
    const mixedRow = mixedSigned[0];
    const cleanRow = cleanSigned[0];
    if (!mixedRow || !cleanRow) throw new Error('missing signed output');
    expect(mixedRow.heartbeat.seq).toBe(0);
    expect(mixedRow.heartbeat.prev_hash).toBe(GENESIS_PREV_HASH);
    expect(mixedRow.heartbeat.exchange).toEqual(cleanRow.heartbeat.exchange);
    expect(mixedRow.heartbeat.hash).toBe(cleanRow.heartbeat.hash);
    expect(await verifyHeartbeat(mixedRow.heartbeat, mixedRow.node.public_key, 0, GENESIS_PREV_HASH)).toEqual({
      ok: true,
    });

    const mixedNext = await mixed.step(31_000);
    const cleanNext = await clean.step(31_000);
    const nextRow = mixedNext[0];
    const cleanNextRow = cleanNext[0];
    if (!nextRow || !cleanNextRow) throw new Error('missing second signed output');
    expect(nextRow.heartbeat.seq).toBe(1);
    expect(nextRow.heartbeat.prev_hash).toBe(mixedRow.heartbeat.hash);
    expect(nextRow.heartbeat.exchange).toEqual(cleanNextRow.heartbeat.exchange);
    expect(await verifyHeartbeat(nextRow.heartbeat, nextRow.node.public_key, 1, mixedRow.heartbeat.hash)).toEqual({
      ok: true,
    });
  });

  it('stops applying a fault after stopFault', async () => {
    const sim = await createSim(3);
    const t0 = 80_000;
    const before = await sim.step(t0);
    const alpha = before[0];
    if (!alpha) throw new Error('missing V-Alpha');
    const nodeId: UUID = alpha.node.id;
    const baseline = peerOffsetMs(alpha.heartbeat.exchange.at(-1)!);
    const faultId = '10000000-0000-4000-8000-000000000012';

    sim.applyFault(
      makeFault({
        id: faultId,
        type: 'clock_step',
        node_id: nodeId,
        params: { offset_ms: 10 },
        started_at_ms: t0,
      }),
    );
    const during = (await sim.step(t0 + 1000)).find((row) => row.node.id === nodeId);
    if (!during) throw new Error('missing node during fault');
    expect(sim.faultOffsetMs(nodeId, t0 + 1000)).toBe(10);

    sim.stopFault(faultId);
    const t2 = t0 + 2000;
    const after = (await sim.step(t2)).find((row) => row.node.id === nodeId);
    if (!after) throw new Error('missing node after stop');
    const stopped = peerOffsetMs(after.heartbeat.exchange.at(-1)!);

    expect(sim.faultOffsetMs(nodeId, t2)).toBe(0);
    expect(Math.abs(stopped - baseline)).toBeLessThan(3);
    expect(Math.abs(stopped - peerOffsetMs(during.heartbeat.exchange.at(-1)!))).toBeGreaterThan(5);
  });
});
