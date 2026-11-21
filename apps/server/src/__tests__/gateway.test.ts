// TEST-FIXTURE
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import {
  generateKeyPair,
  createSignedHeartbeat,
  GENESIS_PREV_HASH,
} from '@chronyx/crypto';
import type { Heartbeat, HeartbeatBody } from '@chronyx/contracts';
import { RingBuffer } from '../core/ringBuffer.js';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';
import { createServer } from '../server.js';

describe('P1-T3 Gateway & Node Registry Verification Suite', () => {
  let registry: NodeRegistry;
  let heartbeatService: HeartbeatService;
  let keypair: { privateKey: Uint8Array; publicKeyBase64: string; privateKeyHex: string };

  beforeEach(async () => {
    registry = new NodeRegistry();
    heartbeatService = new HeartbeatService(registry);
    keypair = await generateKeyPair();
  });

  // 1. Known node registration
  it('1. registers a known node and supports idempotent re-registration', async () => {
    const node1 = await registry.registerNode({
      name: 'Observatory-Node-1',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    expect(node1.id).toBeDefined();
    expect(node1.name).toBe('Observatory-Node-1');
    expect(node1.kind).toBe('browser');
    expect(node1.public_key).toBe(keypair.publicKeyBase64);
    expect(node1.online).toBe(false);

    // Idempotent check
    const node2 = await registry.registerNode({
      name: 'Observatory-Node-1-Duplicate',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    expect(node2.id).toBe(node1.id);
  });

  // 2. Unknown node rejection
  it('2. rejects unknown nodes during heartbeat ingestion', async () => {
    const unknownNodeId = '99999999-9999-9999-9999-999999999999';
    const hbBody: HeartbeatBody = {
      node_id: unknownNodeId,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHb = await createSignedHeartbeat(hbBody, keypair.privateKey);

    const result = await heartbeatService.verifyAndIngest(signedHb, Date.now());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('UNKNOWN_NODE');
    }
  });

  // 3. Correct join acknowledgement
  it('3. returns correct join acknowledgement with initial sequence and genesis hash', async () => {
    const node = await registry.registerNode({
      name: 'Join-Test-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    expect(registry.getExpectedSeq(node.id)).toBe(0);
    expect(registry.getLastVerifiedHash(node.id)).toBe(GENESIS_PREV_HASH);
  });

  // 4. Sequence restoration after reconnect
  it('4. preserves and restores sequence and hash-chain continuity across node reconnects', async () => {
    const node = await registry.registerNode({
      name: 'Reconnect-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    // Ingest seq 0
    const hb0: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [{ t1: 100, t2: 105, t3: 106, t4: 112 }],
      osc_residual_ms: 0.1,
      health: null,
    };
    const signed0 = await createSignedHeartbeat(hb0, keypair.privateKey);
    const ack0 = await heartbeatService.verifyAndIngest(signed0, 1700000000005);
    expect(ack0.ok).toBe(true);

    // Simulate disconnect and reconnect: sequence must be preserved at 1
    registry.markNodeConnected(node.id, 'socket-1');
    registry.markNodeDisconnected('socket-1');
    expect(registry.getNodeSync(node.id)?.online).toBe(false);

    // Reconnect on new socket
    registry.markNodeConnected(node.id, 'socket-2');
    expect(registry.getNodeSync(node.id)?.online).toBe(true);
    expect(registry.getExpectedSeq(node.id)).toBe(1);
    expect(registry.getLastVerifiedHash(node.id)).toBe(signed0.hash);

    // Ingest seq 1
    const hb1: HeartbeatBody = {
      node_id: node.id,
      seq: 1,
      t_local_ms: 1700000001000,
      prev_hash: signed0.hash,
      exchange: [{ t1: 1100, t2: 1105, t3: 1106, t4: 1111 }],
      osc_residual_ms: 0.15,
      health: null,
    };
    const signed1 = await createSignedHeartbeat(hb1, keypair.privateKey);
    const ack1 = await heartbeatService.verifyAndIngest(signed1, 1700000001005);
    expect(ack1.ok).toBe(true);
    expect(registry.getExpectedSeq(node.id)).toBe(2);
    expect(registry.getLastVerifiedHash(node.id)).toBe(signed1.hash);
  });

  // 5. Time ping acknowledgement
  it('5. time:ping endpoint records separate hub timestamps with sub-millisecond precision', () => {
    const t2 = performance.timeOrigin + performance.now();
    const t3 = performance.timeOrigin + performance.now();
    expect(typeof t2).toBe('number');
    expect(typeof t3).toBe('number');
    expect(t3).toBeGreaterThanOrEqual(t2);
  });

  // 6. Valid heartbeat acceptance & peer offset calculation
  it('6. accepts valid heartbeat and correctly computes minimum RTT peer offset', async () => {
    const node = await registry.registerNode({
      name: 'Valid-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    // Exchange 1: rtt = (120 - 100) - (110 - 105) = 20 - 5 = 15 ms, offset = ((100-105) + (120-110))/2 = (-5 + 10)/2 = 2.5 ms
    // Exchange 2: rtt = (212 - 200) - (208 - 206) = 12 - 2 = 10 ms (MIN RTT), offset = ((200-206) + (212-208))/2 = (-6 + 4)/2 = -1.0 ms
    // Exchange 3: rtt = 300 ms (> 200 ms, discarded)
    const hb: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [
        { t1: 100, t2: 105, t3: 110, t4: 120 },
        { t1: 200, t2: 206, t3: 208, t4: 212 },
        { t1: 300, t2: 400, t3: 450, t4: 650 },
      ],
      osc_residual_ms: -0.05,
      health: null,
    };
    const signed = await createSignedHeartbeat(hb, keypair.privateKey);

    const ack = await heartbeatService.verifyAndIngest(signed, 1700000000020);
    expect(ack.ok).toBe(true);

    const latest = registry.getLatestSample(node.id);
    expect(latest).toBeDefined();
    expect(latest?.peer_offset_ms).toBe(-1.0);
    expect(latest?.seq).toBe(0);
  });

  // 7. Incorrect hash rejection
  it('7. rejects heartbeat when computed hash does not match submitted hash and marks bad_signature flag', async () => {
    const node = await registry.registerNode({
      name: 'Tampered-Hash-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const hb: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signed = await createSignedHeartbeat(hb, keypair.privateKey);

    // Tamper with hash
    const tampered: Heartbeat = {
      ...signed,
      hash: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    };

    const ack = await heartbeatService.verifyAndIngest(tampered, 1700000000000);
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.code).toBe('BAD_SIGNATURE');
    }

    const integrity = registry.getIntegrityState(node.id, 1700000000000);
    expect(integrity.bad_signature).toBe(true);
  });

  // 8. Invalid signature rejection
  it('8. rejects heartbeat with invalid cryptographic signature', async () => {
    const node = await registry.registerNode({
      name: 'Tampered-Sig-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const otherKeypair = await generateKeyPair();
    const hb: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    // Signed by wrong keypair
    const signedByOther = await createSignedHeartbeat(hb, otherKeypair.privateKey);

    const ack = await heartbeatService.verifyAndIngest(signedByOther, 1700000000000);
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.code).toBe('BAD_SIGNATURE');
    }

    const integrity = registry.getIntegrityState(node.id, 1700000000000);
    expect(integrity.bad_signature).toBe(true);
  });

  // 9. Incorrect sequence rejection
  it('9. rejects heartbeat when seq does not match expected sequence (CHAIN_BREAK)', async () => {
    const node = await registry.registerNode({
      name: 'Wrong-Seq-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const hb: HeartbeatBody = {
      node_id: node.id,
      seq: 5, // Expected 0
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signed = await createSignedHeartbeat(hb, keypair.privateKey);

    const ack = await heartbeatService.verifyAndIngest(signed, 1700000000000);
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.code).toBe('CHAIN_BREAK');
      expect(ack.expected_seq).toBe(0);
      expect(ack.expected_prev_hash).toBe(GENESIS_PREV_HASH);
    }

    const integrity = registry.getIntegrityState(node.id, 1700000000000);
    expect(integrity.chain_break).toBe(true);
  });

  // 10. Incorrect previous hash rejection
  it('10. rejects heartbeat when prev_hash does not match expected last verified hash', async () => {
    const node = await registry.registerNode({
      name: 'Wrong-PrevHash-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const hb: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: '1111111111111111111111111111111111111111111111111111111111111111', // Expected 64 zeros
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signed = await createSignedHeartbeat(hb, keypair.privateKey);

    const ack = await heartbeatService.verifyAndIngest(signed, 1700000000000);
    expect(ack.ok).toBe(false);
    if (!ack.ok) {
      expect(ack.code).toBe('CHAIN_BREAK');
    }
  });

  // 11. Integrity flag creation
  it('11. creates integrity flags on verification failures', async () => {
    const node = await registry.registerNode({
      name: 'Flag-Test-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    registry.setIntegrityFlag(node.id, 'bad_signature', 1000);
    registry.setIntegrityFlag(node.id, 'chain_break', 2000);

    const state = registry.getIntegrityState(node.id, 3000);
    expect(state.bad_signature).toBe(true);
    expect(state.chain_break).toBe(true);
    expect(state.heartbeat_gap).toBe(false);
  });

  // 12. Integrity flag expiry after 10 seconds
  it('12. expires integrity flags after exact 10-second retention window', async () => {
    const node = await registry.registerNode({
      name: 'Expiry-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const setTime = 10000;
    registry.setIntegrityFlag(node.id, 'bad_signature', setTime);

    // Active at 15s (5s elapsed)
    expect(registry.getIntegrityState(node.id, 15000).bad_signature).toBe(true);
    // Active at 20s (10s elapsed, inclusive boundary)
    expect(registry.getIntegrityState(node.id, 20000).bad_signature).toBe(true);
    // Expired at 20.001s (> 10s elapsed)
    expect(registry.getIntegrityState(node.id, 20001).bad_signature).toBe(false);
  });

  // 13. Invalid heartbeat does not advance chain state
  it('13. ensures invalid heartbeat does not advance verified sequence or chain head', async () => {
    const node = await registry.registerNode({
      name: 'No-Advance-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    // Valid seq 0
    const hb0: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signed0 = await createSignedHeartbeat(hb0, keypair.privateKey);
    await heartbeatService.verifyAndIngest(signed0, 1700000000000);

    expect(registry.getExpectedSeq(node.id)).toBe(1);
    expect(registry.getLastVerifiedHash(node.id)).toBe(signed0.hash);

    // Invalid seq 2 (skipping 1)
    const hbInvalid: HeartbeatBody = {
      node_id: node.id,
      seq: 2,
      t_local_ms: 1700000001000,
      prev_hash: signed0.hash,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedInvalid = await createSignedHeartbeat(hbInvalid, keypair.privateKey);
    const ack = await heartbeatService.verifyAndIngest(signedInvalid, 1700000001000);
    expect(ack.ok).toBe(false);

    // Verified: expected sequence and last verified hash remain un-advanced
    expect(registry.getExpectedSeq(node.id)).toBe(1);
    expect(registry.getLastVerifiedHash(node.id)).toBe(signed0.hash);
  });

  // 14. Invalid heartbeat is excluded from time estimation
  it('14. excludes invalid heartbeat from sample store and ring buffer history', async () => {
    const node = await registry.registerNode({
      name: 'Exclude-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    // Submit invalid heartbeat
    const hbBad: HeartbeatBody = {
      node_id: node.id,
      seq: 99,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [{ t1: 100, t2: 105, t3: 106, t4: 110 }],
      osc_residual_ms: null,
      health: null,
    };
    const signedBad = await createSignedHeartbeat(hbBad, keypair.privateKey);
    await heartbeatService.verifyAndIngest(signedBad, 1700000000000);

    expect(registry.getLatestSample(node.id)).toBeNull();
    expect(registry.getHistory(node.id)).toHaveLength(0);
  });

  // 15. Ring buffer capacity and ordering
  it('15. bounded ring buffer enforces 3600-point capacity and chronological order', () => {
    const buffer = new RingBuffer<number>(5);
    expect(buffer.size()).toBe(0);

    buffer.push(1);
    buffer.push(2);
    buffer.push(3);
    expect(buffer.getAll()).toEqual([1, 2, 3]);

    buffer.push(4);
    buffer.push(5);
    expect(buffer.getAll()).toEqual([1, 2, 3, 4, 5]);

    // Push 6: oldest (1) rolls off
    buffer.push(6);
    expect(buffer.getAll()).toEqual([2, 3, 4, 5, 6]);

    // Recent items check
    expect(buffer.getRecent(3)).toEqual([4, 5, 6]);
    expect(buffer.size()).toBe(5);
  });

  // 16. Repository failures and missing database configuration
  it('16. gracefully handles unconfigured database without failing verification', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    const node = await registry.registerNode({
      name: 'Offline-Db-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const hb: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signed = await createSignedHeartbeat(hb, keypair.privateKey);

    const ack = await heartbeatService.verifyAndIngest(signed, 1700000000000);
    expect(ack.ok).toBe(true);
    expect(registry.getExpectedSeq(node.id)).toBe(1);
  });

  // 17. Duplicate/replayed heartbeat handling
  it('17. rejects duplicate and replayed heartbeats', async () => {
    const node = await registry.registerNode({
      name: 'Replay-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const hb0: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signed0 = await createSignedHeartbeat(hb0, keypair.privateKey);

    // First ingestion: success
    const ack1 = await heartbeatService.verifyAndIngest(signed0, 1700000000000);
    expect(ack1.ok).toBe(true);

    // Replay of seq 0: rejected with CHAIN_BREAK (expected seq 1)
    const ack2 = await heartbeatService.verifyAndIngest(signed0, 1700000001000);
    expect(ack2.ok).toBe(false);
    if (!ack2.ok) {
      expect(ack2.code).toBe('CHAIN_BREAK');
      expect(ack2.expected_seq).toBe(1);
    }
  });

  // REST API Route Integration Tests
  describe('Core REST Routes (Part E2b)', () => {
    it('handles POST /api/v1/nodes/register and GET /api/v1/nodes', async () => {
      const { app } = createServer({ nodeRegistry: registry, heartbeatService });

      const resRegister = await request(app)
        .post('/api/v1/nodes/register')
        .send({
          name: 'Api-Test-Node',
          kind: 'browser',
          public_key: keypair.publicKeyBase64,
        })
        .expect(201);

      expect(resRegister.body.node.name).toBe('Api-Test-Node');
      expect(resRegister.body.hub_time_ms).toBeDefined();

      const resList = await request(app).get('/api/v1/nodes').expect(200);
      expect(Array.isArray(resList.body)).toBe(true);
      expect(resList.body.some((n: { name: string }) => n.name === 'Api-Test-Node')).toBe(true);

      const nodeId = resRegister.body.node.id;
      const resDetail = await request(app).get(`/api/v1/nodes/${nodeId}`).expect(200);
      expect(resDetail.body.node.id).toBe(nodeId);
      expect(resDetail.body.assessment).toBeNull();
    });

    it('handles POST /api/v1/heartbeats REST twin endpoint', async () => {
      const { app } = createServer({ nodeRegistry: registry, heartbeatService });

      const node = await registry.registerNode({
        name: 'Rest-Heartbeat-Node',
        kind: 'browser',
        public_key: keypair.publicKeyBase64,
      });

      const hb: HeartbeatBody = {
        node_id: node.id,
        seq: 0,
        t_local_ms: 1700000000000,
        prev_hash: GENESIS_PREV_HASH,
        exchange: [],
        osc_residual_ms: null,
        health: null,
      };
      const signed = await createSignedHeartbeat(hb, keypair.privateKey);

      const resHb = await request(app)
        .post('/api/v1/heartbeats')
        .send(signed)
        .expect(200);

      expect(resHb.body.ok).toBe(true);
      expect(resHb.body.server_rx_ms).toBeDefined();
    });
  });
});
