// TEST-FIXTURE
import { describe, expect, it } from 'vitest';
import type { EngineTickInput, NodeTickInput, TrustState } from '@chronyx/contracts';
import { DEFAULT_ENGINE_CONFIG } from '@chronyx/contracts';
import { createEngine, normalCdf } from '../index.js';

const T0 = 1_700_000_000_000;

function node(
  id: string,
  peer: number | null,
  extra: Partial<NodeTickInput> = {},
): NodeTickInput {
  return {
    node_id: id,
    online: true,
    peer_offset_ms: peer,
    osc_residual_ms: null,
    gnss_resid_ms: null,
    camera_resid_ms: null,
    health: null,
    integrity: { bad_signature: false, chain_break: false, heartbeat_gap: false },
    ...extra,
  };
}

function cluster(
  peers: Array<number | null>,
  extraFor?: (index: number) => Partial<NodeTickInput>,
): NodeTickInput[] {
  return peers.map((peer, index) => node(`n${index + 1}`, peer, extraFor ? extraFor(index) : {}));
}

function tick(
  engine: ReturnType<typeof createEngine>,
  nowMs: number,
  nodes: NodeTickInput[],
  anchor: EngineTickInput['anchor'] = { ok: true, offset_ms: 0, sigma_ms: null },
) {
  return engine.tick({ now_ms: nowMs, nodes, anchor });
}

function stateOf(engineOut: ReturnType<typeof tick>, id: string): TrustState | undefined {
  return engineOut.assessments.find((row) => row.node_id === id)?.state;
}

describe('E3b detection engine', () => {
  it('uses the E3b configuration defaults', () => {
    const engine = createEngine();
    expect(engine.getConfig()).toEqual(DEFAULT_ENGINE_CONFIG);
  });

  it('keeps every node trusted through a clean 10-minute run', () => {
    const engine = createEngine();
    const peers = [0, 0, 0, 0];
    for (let step = 0; step < 600; step += 1) {
      const out = tick(engine, T0 + step * 1000, cluster(peers));
      expect(out.transitions).toEqual([]);
      expect(out.assessments.every((row) => row.state === 'trusted')).toBe(true);
    }
  });

  it('quarantines a +10 ms step within 6 ticks', () => {
    const engine = createEngine();
    const peers = [10, 0, 0, 0];
    let quarantinedAt = -1;
    const seen: TrustState[] = [];
    for (let step = 0; step < 6; step += 1) {
      const out = tick(engine, T0 + step * 1000, cluster(peers));
      const state = stateOf(out, 'n1');
      if (state) seen.push(state);
      if (quarantinedAt < 0 && state === 'quarantined') quarantinedAt = step;
    }
    expect(quarantinedAt).toBeGreaterThanOrEqual(0);
    expect(quarantinedAt).toBeLessThan(6);
    expect(seen).toContain('suspect');
  });

  it('flags a 0.5 ms/min ramp by CUSUM before |z| reaches z_suspect', () => {
    const engine = createEngine();
    const calm = [0, 0, 0, 0];
    for (let step = 0; step < 5; step += 1) tick(engine, T0 + step * 1000, cluster(calm));

    let firstCusum = -1;
    let firstZ = -1;
    for (let step = 0; step < 400; step += 1) {
      const offset = 0.5 * (step / 60);
      const out = tick(engine, T0 + (step + 5) * 1000, cluster([offset, 0, 0, 0]));
      const row = out.assessments.find((item) => item.node_id === 'n1');
      if (!row) throw new Error('missing node');
      if (firstCusum < 0 && row.cusum > DEFAULT_ENGINE_CONFIG.cusum_h_sigma) firstCusum = step;
      if (firstZ < 0 && Math.abs(row.z) >= DEFAULT_ENGINE_CONFIG.z_suspect) firstZ = step;
    }
    expect(firstCusum).toBeGreaterThanOrEqual(0);
    expect(firstZ).toBeGreaterThan(firstCusum);
  });

  it('returns a suspect node to trusted after a calm recover_ticks run', () => {
    const engine = createEngine();
    const calm = [0, 0, 0, 0];
    for (let step = 0; step < 5; step += 1) tick(engine, T0 + step * 1000, cluster(calm));
    tick(engine, T0 + 5000, cluster([1, 0, 0, 0]));
    const second = tick(engine, T0 + 6000, cluster([1, 0, 0, 0]));
    expect(stateOf(second, 'n1')).toBe('suspect');

    let trustedAgain = false;
    let sawQuarantine = false;
    for (let step = 7; step < 80; step += 1) {
      const out = tick(engine, T0 + step * 1000, cluster(calm));
      const state = stateOf(out, 'n1');
      if (state === 'quarantined') sawQuarantine = true;
      if (state === 'trusted') {
        trustedAgain = true;
        break;
      }
    }
    expect(sawQuarantine).toBe(false);
    expect(trustedAgain).toBe(true);
  });

  it('recovers from quarantine through recovering into trusted', () => {
    const engine = createEngine();
    const calm = [0, 0, 0, 0];
    let sawQuarantine = false;
    let sawRecovering = false;
    for (let step = 0; step < 3; step += 1) {
      const out = tick(engine, T0 + step * 1000, cluster([1.25, 0, 0, 0]));
      if (stateOf(out, 'n1') === 'quarantined') sawQuarantine = true;
    }
    expect(sawQuarantine).toBe(true);

    let trustedAgain = false;
    for (let step = 3; step < 220; step += 1) {
      const out = tick(engine, T0 + step * 1000, cluster(calm));
      const state = stateOf(out, 'n1');
      if (state === 'recovering') sawRecovering = true;
      if (state === 'trusted') {
        trustedAgain = true;
        break;
      }
    }
    expect(sawRecovering).toBe(true);
    expect(trustedAgain).toBe(true);
  });

  it('reports INSUFFICIENT_PEERS and does not change state below 3 eligible nodes', () => {
    const engine = createEngine();
    const out = tick(engine, T0, [
      node('n1', 40, { integrity: { bad_signature: true, chain_break: false, heartbeat_gap: false } }),
      node('n2', 0),
    ]);
    expect(out.transitions).toEqual([]);
    expect(out.assessments.every((row) => row.state === 'trusted')).toBe(true);
    expect(out.assessments.every((row) => row.reasons.includes('INSUFFICIENT_PEERS'))).toBe(true);
    expect(out.assessments.every((row) => row.confidence <= 0.5)).toBe(true);
  });

  it('excludes offline nodes from consensus and keeps their trust state', () => {
    const engine = createEngine();
    for (let step = 0; step < 5; step += 1) tick(engine, T0 + step * 1000, cluster([0, 0, 0, 0]));
    tick(engine, T0 + 5000, cluster([1, 0, 0, 0]));
    const suspect = tick(engine, T0 + 6000, cluster([1, 0, 0, 0]));
    expect(stateOf(suspect, 'n1')).toBe('suspect');

    const offline = tick(engine, T0 + 7000, [
      node('n1', 100, { online: false }),
      node('n2', 0),
      node('n3', 5),
      node('n4', 0),
    ]);
    expect(stateOf(offline, 'n1')).toBe('suspect');
    expect(offline.consensus_ms).toBe(0);
    expect(offline.assessments.find((row) => row.node_id === 'n1')?.reasons).toContain('NODE_OFFLINE');
    expect(offline.assessments.find((row) => row.node_id === 'n1')?.confidence).toBe(0);
  });

  it('suspects a node on a bad signature or a chain break', () => {
    const bad = createEngine();
    const badOut = tick(bad, T0, [
      node('n1', 0, { integrity: { bad_signature: true, chain_break: false, heartbeat_gap: false } }),
      node('n2', 0),
      node('n3', 0),
      node('n4', 0),
    ]);
    expect(stateOf(badOut, 'n1')).toBe('suspect');
    expect(badOut.assessments.find((row) => row.node_id === 'n1')?.reasons).toContain('BAD_SIGNATURE');

    const chain = createEngine();
    const chainOut = tick(chain, T0, [
      node('n1', 0, { integrity: { bad_signature: false, chain_break: true, heartbeat_gap: false } }),
      node('n2', 0),
      node('n3', 0),
      node('n4', 0),
    ]);
    expect(stateOf(chainOut, 'n1')).toBe('suspect');
    expect(chainOut.assessments.find((row) => row.node_id === 'n1')?.reasons).toContain('CHAIN_BREAK');
  });

  it('quarantines persistent integrity flags after 10 seconds', () => {
    const engine = createEngine();
    const nodes = [
      node('n1', 0, { integrity: { bad_signature: true, chain_break: false, heartbeat_gap: false } }),
      node('n2', 0),
      node('n3', 0),
      node('n4', 0),
    ];
    const first = tick(engine, T0, nodes);
    expect(stateOf(first, 'n1')).toBe('suspect');
    let quarantinedAt = -1;
    for (let step = 1; step <= 10; step += 1) {
      const out = tick(engine, T0 + step * 1000, nodes);
      if (stateOf(out, 'n1') === 'quarantined') {
        quarantinedAt = step;
        break;
      }
    }
    expect(quarantinedAt).toBe(10);
  });

  it('classifies local clock, GNSS spoof, and camera path', () => {
    const local = createEngine();
    const localOut = tick(local, T0, cluster([10, 0, 0, 0], (index) => (index === 0 ? { gnss_resid_ms: 5 } : { gnss_resid_ms: 0 })));
    expect(stateOf(localOut, 'n1')).not.toBe('trusted');
    expect(localOut.assessments.find((row) => row.node_id === 'n1')?.suspected_cause).toBe('local_clock');

    const spoof = createEngine();
    const spoofOut = tick(spoof, T0, cluster([10, 0, 0, 0], (index) => (index === 0 ? { gnss_resid_ms: 0 } : { gnss_resid_ms: 0 })));
    expect(spoofOut.assessments.find((row) => row.node_id === 'n1')?.suspected_cause).toBe('gnss_spoof');

    const camera = createEngine();
    const cameraOut = tick(
      camera,
      T0,
      cluster([0, 0, 0, 0], (index) =>
        index === 0 ? { gnss_resid_ms: 5, camera_resid_ms: 5 } : { gnss_resid_ms: 0, camera_resid_ms: 0 },
      ),
    );
    expect(stateOf(cameraOut, 'n1')).not.toBe('trusted');
    expect(cameraOut.assessments.find((row) => row.node_id === 'n1')?.suspected_cause).toBe('camera_path');
  });

  it('follows the gated normal confidence formula', () => {
    const engine = createEngine();
    const anchor = { ok: true, offset_ms: 0, sigma_ms: null };
    const calm = tick(engine, T0, cluster([0, 0, 0, 0]), anchor);
    const sigma = DEFAULT_ENGINE_CONFIG.min_sigma_ms;
    const tol = DEFAULT_ENGINE_CONFIG.tolerance_ms;
    const full = normalCdf((tol - 0) / sigma) - normalCdf((-tol - 0) / sigma);
    expect(calm.assessments[0]?.confidence).toBeCloseTo(DEFAULT_ENGINE_CONFIG.gate.trusted * full, 6);

    const jumped = tick(engine, T0 + 1000, cluster([10, 0, 0, 0]), anchor);
    const row = jumped.assessments.find((item) => item.node_id === 'n1');
    const mu = 10;
    const suspectP = normalCdf((tol - mu) / sigma) - normalCdf((-tol - mu) / sigma);
    expect(row?.state).toBe('suspect');
    expect(row?.confidence).toBeCloseTo(DEFAULT_ENGINE_CONFIG.gate.suspect * suspectP, 6);

    tick(engine, T0 + 2000, cluster([10, 0, 0, 0]), anchor);
    const later = tick(engine, T0 + 3000, cluster([10, 0, 0, 0]), anchor);
    const quarantined = later.assessments.find((item) => item.node_id === 'n1');
    expect(quarantined?.state).toBe('quarantined');
    expect(quarantined?.confidence).toBe(0);
  });

  it('computes network score, fault tolerance, and anchor_ok', () => {
    const engine = createEngine();
    const healthy = tick(engine, T0, cluster([0, 0, 0, 0]), { ok: true, offset_ms: 1, sigma_ms: null });
    expect(healthy.network.n).toBe(4);
    expect(healthy.network.fault_tolerance_f).toBe(1);
    expect(healthy.network.trusted).toBe(4);
    expect(healthy.network.anchor_ok).toBe(true);
    expect(healthy.network.score).toBe(100);

    const wide = tick(engine, T0 + 1000, cluster([0, 0, 0, 0]), {
      ok: true,
      offset_ms: 11,
      sigma_ms: null,
    });
    expect(wide.network.anchor_ok).toBe(false);
  });
});
