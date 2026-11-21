// TEST-FIXTURE
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  generateKeyPair,
  createSignedHeartbeat,
  GENESIS_PREV_HASH,
} from '@chronyx/crypto';
import type { HeartbeatBody, NodeInfo } from '@chronyx/contracts';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';
import * as dbModule from '../core/db/index.js';
import { createServer } from '../server.js';
import request from 'supertest';

describe('P1-T3-REL Gateway Persistence & Hydration Reliability', () => {
  let registry: NodeRegistry;
  let heartbeatService: HeartbeatService;
  let keypair: { privateKey: Uint8Array; publicKeyBase64: string; privateKeyHex: string };

  beforeEach(async () => {
    registry = new NodeRegistry();
    heartbeatService = new HeartbeatService(registry);
    keypair = await generateKeyPair();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Hydration restores expected sequence and last hash
  it('1. restores expected sequence and last hash from persisted heartbeat on hydration', async () => {
    const testNodeId = '11111111-1111-1111-1111-111111111111';
    const persistedHash = 'a'.repeat(64);

    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      nodes: {
        findById: vi.fn().mockResolvedValue({
          id: testNodeId,
          name: 'Persisted-Observatory',
          kind: 'browser',
          public_key: keypair.publicKeyBase64,
          created_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        }),
      },
      heartbeats: {
        listLatestByNode: vi.fn().mockResolvedValue([
          {
            id: 100,
            node_id: testNodeId,
            seq: 42,
            hash: persistedHash,
            prev_hash: 'b'.repeat(64),
            t_rx_ms: 1700000042000,
          },
        ]),
      },
    } as unknown as dbModule.DatabaseRepositories);

    const node = await registry.getNode(testNodeId);
    expect(node).not.toBeNull();
    expect(registry.getExpectedSeq(testNodeId)).toBe(43);
    expect(registry.getLastVerifiedHash(testNodeId)).toBe(persistedHash);
  });

  // 2. Empty persisted history uses genesis state
  it('2. initializes to genesis sequence and hash when persisted node has zero heartbeats', async () => {
    const testNodeId = '22222222-2222-2222-2222-222222222222';

    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      nodes: {
        findById: vi.fn().mockResolvedValue({
          id: testNodeId,
          name: 'Brand-New-Node',
          kind: 'browser',
          public_key: keypair.publicKeyBase64,
          created_at: new Date().toISOString(),
          last_seen_at: null,
        }),
      },
      heartbeats: {
        listLatestByNode: vi.fn().mockResolvedValue([]),
      },
    } as unknown as dbModule.DatabaseRepositories);

    const node = await registry.getNode(testNodeId);
    expect(node).not.toBeNull();
    expect(registry.getExpectedSeq(testNodeId)).toBe(0);
    expect(registry.getLastVerifiedHash(testNodeId)).toBe(GENESIS_PREV_HASH);
  });

  // 3. Hydration database failure prevents unsafe node acceptance
  it('3. throws on database error during hydration, preventing unsafe acceptance with genesis state', async () => {
    const testNodeId = '33333333-3333-3333-3333-333333333333';

    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      nodes: {
        findById: vi.fn().mockResolvedValue({
          id: testNodeId,
          name: 'Failing-Node',
          kind: 'browser',
          public_key: keypair.publicKeyBase64,
          created_at: new Date().toISOString(),
          last_seen_at: null,
        }),
      },
      heartbeats: {
        listLatestByNode: vi.fn().mockRejectedValue(new Error('Connection lost to Supabase')),
      },
    } as unknown as dbModule.DatabaseRepositories);

    await expect(registry.getNode(testNodeId)).rejects.toThrow('Connection lost to Supabase');
    // Ensure node was NOT registered with false genesis state in memory
    expect(registry.getNodeSync(testNodeId)).toBeNull();
  });

  // 4. Restart followed by reconnect continues the existing hash chain
  it('4. accepts the next continuous heartbeat after restart hydration', async () => {
    const testNodeId = '44444444-4444-4444-4444-444444444444';
    const lastHash = 'c'.repeat(64);

    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      nodes: {
        findById: vi.fn().mockResolvedValue({
          id: testNodeId,
          name: 'Reconnecting-Node',
          kind: 'browser',
          public_key: keypair.publicKeyBase64,
          created_at: new Date().toISOString(),
          last_seen_at: new Date().toISOString(),
        }),
        updateLastSeen: vi.fn().mockResolvedValue(undefined),
      },
      heartbeats: {
        listLatestByNode: vi.fn().mockResolvedValue([
          {
            id: 10,
            node_id: testNodeId,
            seq: 9,
            hash: lastHash,
            prev_hash: 'd'.repeat(64),
            t_rx_ms: 1700000009000,
          },
        ]),
        create: vi.fn().mockResolvedValue({ id: 11 }),
      },
    } as unknown as dbModule.DatabaseRepositories);

    // Node is hydrated
    await registry.getNode(testNodeId);
    expect(registry.getExpectedSeq(testNodeId)).toBe(10);
    expect(registry.getLastVerifiedHash(testNodeId)).toBe(lastHash);

    // Node submits next continuous heartbeat (seq 10, prev_hash: lastHash)
    const hbBody: HeartbeatBody = {
      node_id: testNodeId,
      seq: 10,
      t_local_ms: 1700000010000,
      prev_hash: lastHash,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHb = await createSignedHeartbeat(hbBody, keypair.privateKey);

    const ack = await heartbeatService.verifyAndIngest(signedHb, 1700000010500);
    expect(ack.ok).toBe(true);
    expect(registry.getExpectedSeq(testNodeId)).toBe(11);
  });

  // 5. Persistence success produces a successful acknowledgement
  it('5. returns ok: true when database persistence succeeds', async () => {
    const node = await registry.registerNode({
      name: 'Persist-Success-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const createMock = vi.fn().mockResolvedValue({ id: 1 });
    const updateLastSeenMock = vi.fn().mockResolvedValue(undefined);

    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      heartbeats: { create: createMock },
      nodes: { updateLastSeen: updateLastSeenMock },
    } as unknown as dbModule.DatabaseRepositories);

    const hbBody: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHb = await createSignedHeartbeat(hbBody, keypair.privateKey);

    const ack = await heartbeatService.verifyAndIngest(signedHb, Date.now());
    expect(ack.ok).toBe(true);
    expect(createMock).toHaveBeenCalledTimes(1);
    expect(updateLastSeenMock).toHaveBeenCalledTimes(1);
    expect(registry.getExpectedSeq(node.id)).toBe(1);
  });

  // 6. Persistence failure does not advance the verified chain
  it('6. rejects and does NOT advance verified chain when database persistence fails', async () => {
    const node = await registry.registerNode({
      name: 'Persist-Fail-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      heartbeats: {
        create: vi.fn().mockRejectedValue(new Error('PostgreSQL Disk Full')),
      },
      nodes: {
        updateLastSeen: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as dbModule.DatabaseRepositories);

    const hbBody: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHb = await createSignedHeartbeat(hbBody, keypair.privateKey);

    // Should throw out of verifyAndIngest so caller knows persistence failed
    await expect(heartbeatService.verifyAndIngest(signedHb, Date.now())).rejects.toThrow(
      'PostgreSQL Disk Full',
    );

    // CRITICAL: Expected sequence and hash must NOT have advanced!
    expect(registry.getExpectedSeq(node.id)).toBe(0);
    expect(registry.getLastVerifiedHash(node.id)).toBe(GENESIS_PREV_HASH);
  });

  // 7. Concurrent heartbeats for the same node are serialized
  it('7. serializes concurrent heartbeats for the same node preventing race conditions', async () => {
    const node = await registry.registerNode({
      name: 'Concurrent-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    let dbDelayResolve: (() => void) | null = null;
    const dbDelayPromise = new Promise<void>((res) => {
      dbDelayResolve = res;
    });

    let firstHeartbeatEnteredDb = false;

    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      heartbeats: {
        create: vi.fn().mockImplementation(async (hb: { seq: number }) => {
          if (hb.seq === 0) {
            firstHeartbeatEnteredDb = true;
            await dbDelayPromise;
          }
          return { id: hb.seq + 1 };
        }),
      },
      nodes: {
        updateLastSeen: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as dbModule.DatabaseRepositories);

    // Heartbeat 0
    const hb0Body: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHb0 = await createSignedHeartbeat(hb0Body, keypair.privateKey);

    // Heartbeat 1 (must follow hb0)
    const hb1Body: HeartbeatBody = {
      node_id: node.id,
      seq: 1,
      t_local_ms: 1700000001000,
      prev_hash: signedHb0.hash,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHb1 = await createSignedHeartbeat(hb1Body, keypair.privateKey);

    // Dispatch both concurrently
    const p0 = heartbeatService.verifyAndIngest(signedHb0, 1700000000500);
    const p1 = heartbeatService.verifyAndIngest(signedHb1, 1700000001500);

    // Ensure p0 has reached the database delay
    await new Promise((r) => setTimeout(r, 50));
    expect(firstHeartbeatEnteredDb).toBe(true);

    // Release p0 database write
    dbDelayResolve!();

    const [res0, res1] = await Promise.all([p0, p1]);
    expect(res0.ok).toBe(true);
    expect(res1.ok).toBe(true);
    expect(registry.getExpectedSeq(node.id)).toBe(2);
    expect(registry.getLastVerifiedHash(node.id)).toBe(signedHb1.hash);
  });

  // 8. Concurrent heartbeats for different nodes do not block each other
  it('8. executes concurrent heartbeats for different nodes independently', async () => {
    const keypairB = await generateKeyPair();

    const nodeA = await registry.registerNode({
      name: 'Node-A',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });
    const nodeB = await registry.registerNode({
      name: 'Node-B',
      kind: 'browser',
      public_key: keypairB.publicKeyBase64,
    });

    let nodeADelayResolve: (() => void) | null = null;
    const nodeADelay = new Promise<void>((res) => {
      nodeADelayResolve = res;
    });

    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      heartbeats: {
        create: vi.fn().mockImplementation(async (hb: { node_id: string }) => {
          if (hb.node_id === nodeA.id) {
            await nodeADelay;
          }
          return { id: 1 };
        }),
      },
      nodes: {
        updateLastSeen: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as dbModule.DatabaseRepositories);

    const hbABody: HeartbeatBody = {
      node_id: nodeA.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHbA = await createSignedHeartbeat(hbABody, keypair.privateKey);

    const hbBBody: HeartbeatBody = {
      node_id: nodeB.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHbB = await createSignedHeartbeat(hbBBody, keypairB.privateKey);

    const pA = heartbeatService.verifyAndIngest(signedHbA, Date.now());
    const pB = heartbeatService.verifyAndIngest(signedHbB, Date.now());

    // Node B finishes even while Node A is still awaiting database write
    const resB = await pB;
    expect(resB.ok).toBe(true);
    expect(registry.getExpectedSeq(nodeB.id)).toBe(1);

    // Node A has not completed yet
    expect(registry.getExpectedSeq(nodeA.id)).toBe(0);

    // Release Node A
    nodeADelayResolve!();
    const resA = await pA;
    expect(resA.ok).toBe(true);
    expect(registry.getExpectedSeq(nodeA.id)).toBe(1);
  });

  // 9. In-memory-only mode still works when DB is not configured
  it('9. accepts heartbeats in-memory when database is not configured', async () => {
    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(false);

    const node = await registry.registerNode({
      name: 'Memory-Only-Node',
      kind: 'browser',
      public_key: keypair.publicKeyBase64,
    });

    const hbBody: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHb = await createSignedHeartbeat(hbBody, keypair.privateKey);

    const ack = await heartbeatService.verifyAndIngest(signedHb, Date.now());
    expect(ack.ok).toBe(true);
    expect(registry.getExpectedSeq(node.id)).toBe(1);
  });

  // 10. REST and Socket.IO behavior remain consistent
  it('10. surfaces database failures consistently via REST API without returning ok: true', async () => {
    const { app } = createServer();

    // Register node via REST
    const regRes = await request(app)
      .post('/api/v1/nodes/register')
      .send({
        name: 'REST-Node',
        kind: 'browser',
        public_key: keypair.publicKeyBase64,
      });
    expect(regRes.status).toBe(201);
    const node: NodeInfo = regRes.body.node;

    // Simulate database failure during REST heartbeat ingest
    vi.spyOn(dbModule, 'isDbConfigured').mockReturnValue(true);
    vi.spyOn(dbModule, 'getRepositories').mockReturnValue({
      heartbeats: {
        create: vi.fn().mockRejectedValue(new Error('Database uncontactable')),
      },
      nodes: {
        updateLastSeen: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as dbModule.DatabaseRepositories);

    const hbBody: HeartbeatBody = {
      node_id: node.id,
      seq: 0,
      t_local_ms: 1700000000000,
      prev_hash: GENESIS_PREV_HASH,
      exchange: [],
      osc_residual_ms: null,
      health: null,
    };
    const signedHb = await createSignedHeartbeat(hbBody, keypair.privateKey);

    const hbRes = await request(app)
      .post('/api/v1/heartbeats')
      .send(signedHb);

    // Must return 500 internal error rather than 200 ok: true
    expect(hbRes.status).toBe(500);
    expect(hbRes.body.error).toBeDefined();
    expect(hbRes.body.error.code).toBe('INTERNAL');
  });
});
