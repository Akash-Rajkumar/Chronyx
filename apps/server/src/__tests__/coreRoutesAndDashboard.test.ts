// TEST-FIXTURE
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { Server as HttpServer } from 'http';
import type { AddressInfo } from 'net';
import request from 'supertest';
import { io as ClientSocket } from 'socket.io-client';
import {
  CONTRACT_VERSION,
  SnapshotSchema,
  DEFAULT_ENGINE_CONFIG,
  SOCKET_EVENTS,
} from '@chronyx/contracts';
import type {
  Snapshot,
  Assessment,
  UUID,
} from '@chronyx/contracts';
import { createServer } from '../server.js';
import { createCoreRoutes } from '../core/routes.js';
import express from 'express';
import { apiErrorMiddleware } from '../middleware/error.js';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';
import { Orchestrator } from '../core/orchestrator.js';
import { Engine } from '@chronyx/engine';
import type { DatabaseRepositories } from '../core/db/index.js';
import type { IncidentRow } from '../core/db/schema.js';

describe('P1-T4-02B Core REST Routes & Dashboard Subscribe Suite', () => {
  let nodeRegistry: NodeRegistry;
  let heartbeatService: HeartbeatService;
  let stubEngine: Engine;
  let orchestrator: Orchestrator;
  let mockDb: DatabaseRepositories;
  let incidentsStore: IncidentRow[];

  const testNodeId = '44444444-4444-4444-8444-444444444444' as UUID;
  const testNodePublicKey = 'MCowBQYDK2VwAyEATestNode444444444444444444444444444444444=';

  beforeEach(async () => {
    nodeRegistry = new NodeRegistry();
    heartbeatService = new HeartbeatService(nodeRegistry);
    stubEngine = new Engine();
    incidentsStore = [];

    // Mock DB Repositories
    mockDb = {
      incidents: {
        listByStatus: vi.fn(async (status: string, limit = 50) => {
          let list = incidentsStore;
          if (status !== 'all') {
            list = list.filter((i) => i.status === status);
          }
          return list.slice(0, limit);
        }),
        findById: vi.fn(async (id: UUID) => {
          return incidentsStore.find((i) => i.id === id) ?? null;
        }),
        create: vi.fn(async (data: unknown) => data as IncidentRow),
        update: vi.fn(async () => ({} as IncidentRow)),
      },
      assessments: {
        create: vi.fn(async (data: unknown) => data as unknown as void),
        listByNode: vi.fn(async () => []),
      },
      transitions: {
        create: vi.fn(async (data: unknown) => data as unknown as void),
        listByNode: vi.fn(async () => []),
      },
      nodes: {} as unknown as DatabaseRepositories['nodes'],
      heartbeats: {} as unknown as DatabaseRepositories['heartbeats'],
      faults: {} as unknown as DatabaseRepositories['faults'],
      observations: {} as unknown as DatabaseRepositories['observations'],
      benchmarkRuns: {} as unknown as DatabaseRepositories['benchmarkRuns'],
      anchors: {} as unknown as DatabaseRepositories['anchors'],
      config: {} as unknown as DatabaseRepositories['config'],
    } as unknown as DatabaseRepositories;

    orchestrator = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
      db: mockDb,
    });

    await nodeRegistry.registerNode({
      id: testNodeId,
      name: 'Observatory-Station-Alpha',
      kind: 'browser',
      public_key: testNodePublicKey,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. GET /state returns the frozen Snapshot shape
  it('1. GET /api/v1/state returns valid frozen Snapshot contract shape', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    const res = await request(app).get('/api/v1/state').expect(200);

    expect(res.body.contract_version).toBe(CONTRACT_VERSION);
    expect(typeof res.body.server_time_ms).toBe('number');
    expect(Array.isArray(res.body.nodes)).toBe(true);
    expect(Array.isArray(res.body.assessments)).toBe(true);
    expect(res.body.network).toBeDefined();
    expect(Array.isArray(res.body.anchors)).toBe(true);
    expect(Array.isArray(res.body.faults)).toBe(true);
    expect(res.body.baseline).toBeDefined();
    expect(res.body.config).toBeDefined();
    expect(Array.isArray(res.body.open_incidents)).toBe(true);

    const parseResult = SnapshotSchema.safeParse(res.body);
    expect(parseResult.success).toBe(true);
  });

  it('1b. GET /api/v1/state returns score=0 when there are zero nodes (empty network)', async () => {
    const emptyRegistry = new NodeRegistry();
    const emptyOrchestrator = new Orchestrator({ nodeRegistry: emptyRegistry, engine: stubEngine, db: mockDb });
    const { app } = createServer({ nodeRegistry: emptyRegistry, heartbeatService: new HeartbeatService(emptyRegistry), orchestrator: emptyOrchestrator, initVirtualNodes: false });

    const res = await request(app).get('/api/v1/state').expect(200);
    expect(res.body.network.n).toBe(0);
    expect(res.body.network.score).toBe(0);
    expect(res.body.network.trusted).toBe(0);
    expect(res.body.network.anchor_ok).toBe(false);
  });

  it('1c. GET /api/v1/state computes legitimate network score for non-empty node population', async () => {
    const reg = new NodeRegistry();
    const orch = new Orchestrator({ nodeRegistry: reg, engine: stubEngine, db: mockDb });
    const id1 = '11111111-1111-4111-8111-111111111111' as UUID;
    const id2 = '22222222-2222-4222-8222-222222222222' as UUID;
    await reg.registerNode({ id: id1, name: 'Node-1', kind: 'browser', public_key: 'key1' });
    await reg.registerNode({ id: id2, name: 'Node-2', kind: 'browser', public_key: 'key2' });

    // Node 1 is trusted, Node 2 is suspect
    orch.setAssessment({
      node_id: id1,
      t_ms: 1700000000000,
      state: 'trusted',
      error_est_ms: 0.1,
      sigma_ms: 0.2,
      z: 0.5,
      cusum: 0.1,
      confidence: 0.99,
      streams: [],
      reasons: [],
      suspected_cause: 'none',
      quarantined_since_ms: null,
    });
    orch.setAssessment({
      node_id: id2,
      t_ms: 1700000000000,
      state: 'suspect',
      error_est_ms: 3.2,
      sigma_ms: 0.6,
      z: 3.6,
      cusum: 2.5,
      confidence: 0.45,
      streams: [],
      reasons: ['PEER_OUTLIER'],
      suspected_cause: 'local_clock',
      quarantined_since_ms: null,
    });

    const { app } = createServer({ nodeRegistry: reg, heartbeatService: new HeartbeatService(reg), orchestrator: orch, initVirtualNodes: false });
    const res = await request(app).get('/api/v1/state').expect(200);

    expect(res.body.network.n).toBe(2);
    expect(res.body.network.trusted).toBe(1);
    expect(res.body.network.suspect).toBe(1);
    expect(res.body.network.score).toBe(50); // 1/2 = 50%
  });

  // 2. GET /nodes returns actual registry data
  it('2. GET /api/v1/nodes returns actual registered nodes without demo mocks', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator, initVirtualNodes: false });

    const res = await request(app).get('/api/v1/nodes').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].id).toBe(testNodeId);
    expect(res.body[0].name).toBe('Observatory-Station-Alpha');
  });

  // 3. GET /nodes/:id returns node plus latest assessment
  it('3. GET /api/v1/nodes/:id returns node and its latest assessment', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    // Seed an assessment in orchestrator
    const testAssessment: Assessment = {
      node_id: testNodeId,
      t_ms: 1700000000000,
      state: 'trusted',
      error_est_ms: 0.8,
      sigma_ms: 0.25,
      z: 0.2,
      cusum: 0.05,
      confidence: 0.98,
      streams: [],
      reasons: [],
      suspected_cause: 'none',
      quarantined_since_ms: null,
    };
    orchestrator.setAssessment(testAssessment);

    const res = await request(app).get(`/api/v1/nodes/${testNodeId}`).expect(200);

    expect(res.body.node.id).toBe(testNodeId);
    expect(res.body.assessment).toMatchObject({
      node_id: testNodeId,
      state: 'trusted',
      error_est_ms: 0.8,
    });
  });

  // 4. Unknown node returns the correct API error
  it('4. GET /api/v1/nodes/:id returns 404 NOT_FOUND for unknown node', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });
    const unknownId = '99999999-9999-4999-8999-999999999999';

    const res = await request(app).get(`/api/v1/nodes/${unknownId}`).expect(404);

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain(unknownId);
  });

  // 5. GET /nodes/:id/history defaults to 300 seconds
  it('5. GET /api/v1/nodes/:id/history defaults to 300s window and uses genuine assessment values', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    // Seed assessment in orchestrator
    orchestrator.setAssessment({
      node_id: testNodeId,
      t_ms: 1700000000000,
      state: 'trusted',
      error_est_ms: 1.5,
      sigma_ms: 0.35,
      z: 0.8,
      cusum: 0.12,
      confidence: 0.95,
      streams: [],
      reasons: [],
      suspected_cause: 'none',
      quarantined_since_ms: null,
    });

    // Seed sample with genuine peer and oscillator measurements
    nodeRegistry.advanceChain(testNodeId, 0, 'h0', {
      node_id: testNodeId,
      seq: 0,
      t_local_ms: 1700000000000,
      server_rx_ms: 1700000000000,
      peer_offset_ms: 1.5,
      osc_residual_ms: 0.02,
      health: null,
      hash: 'h0',
    });

    const res = await request(app).get(`/api/v1/nodes/${testNodeId}/history`).expect(200);

    expect(res.body.points).toBeDefined();
    expect(Array.isArray(res.body.points)).toBe(true);
    expect(res.body.points.length).toBe(1);
    expect(res.body.points[0].error_est_ms).toBe(1.5);
    expect(res.body.points[0].sigma_ms).toBe(0.35);
    expect(res.body.points[0].confidence).toBe(0.95);
    expect(res.body.points[0].state).toBe('trusted');
    expect(res.body.points[0].streams).toEqual({ peer: 1.5, oscillator: 0.02 });
  });

  it('5b. GET /api/v1/nodes/:id/history returns empty points when node has heartbeats but missing assessment', async () => {
    const unassessedNodeId = '77777777-7777-4777-8777-777777777777' as UUID;
    await nodeRegistry.registerNode({
      id: unassessedNodeId,
      name: 'Unassessed-Node',
      kind: 'browser',
      public_key: 'unassessedKey',
    });

    nodeRegistry.advanceChain(unassessedNodeId, 0, 'h0', {
      node_id: unassessedNodeId,
      seq: 0,
      t_local_ms: 1700000000000,
      server_rx_ms: 1700000000000,
      peer_offset_ms: 2.0,
      osc_residual_ms: 0.01,
      health: null,
      hash: 'h0',
    });

    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });
    const res = await request(app).get(`/api/v1/nodes/${unassessedNodeId}/history`).expect(200);

    // Must NOT synthesize fake confidence: 1.0 or state: 'trusted'
    expect(res.body.points).toEqual([]);
  });

  it('5c. GET /api/v1/nodes/:id/history omits peer from streams when peer measurement is null', async () => {
    orchestrator.setAssessment({
      node_id: testNodeId,
      t_ms: 1700000001000,
      state: 'trusted',
      error_est_ms: 0.5,
      sigma_ms: 0.2,
      z: 0.3,
      cusum: 0.05,
      confidence: 0.99,
      streams: [],
      reasons: [],
      suspected_cause: 'none',
      quarantined_since_ms: null,
    });

    // Seed sample with null peer measurement
    nodeRegistry.advanceChain(testNodeId, 1, 'h1', {
      node_id: testNodeId,
      seq: 1,
      t_local_ms: 1700000001000,
      server_rx_ms: 1700000001000,
      peer_offset_ms: null, // unavailable peer measurement
      osc_residual_ms: 0.03,
      health: null,
      hash: 'h1',
    });

    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });
    const res = await request(app).get(`/api/v1/nodes/${testNodeId}/history`).expect(200);

    expect(res.body.points.length).toBeGreaterThan(0);
    const lastPoint = res.body.points[res.body.points.length - 1];
    expect(lastPoint.streams.peer).toBeUndefined();
    expect(lastPoint.streams.oscillator).toBe(0.03);
  });

  // 6. History rejects values outside 30–3600 seconds
  it('6. GET /api/v1/nodes/:id/history rejects window_s outside 30-3600', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    // Under 30
    const resUnder = await request(app)
      .get(`/api/v1/nodes/${testNodeId}/history?window_s=10`)
      .expect(400);
    expect(resUnder.body.error.code).toBe('BAD_REQUEST');

    // Over 3600
    const resOver = await request(app)
      .get(`/api/v1/nodes/${testNodeId}/history?window_s=5000`)
      .expect(400);
    expect(resOver.body.error.code).toBe('BAD_REQUEST');

    // Valid inside range
    await request(app)
      .get(`/api/v1/nodes/${testNodeId}/history?window_s=600`)
      .expect(200);
  });

  // 7. History does not fabricate missing points
  it('7. History returns empty points array for unheartbeated node', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    const res = await request(app).get(`/api/v1/nodes/${testNodeId}/history`).expect(200);

    expect(res.body.points).toEqual([]);
  });

  // 8. GET /incidents correctly filters open, closed and all
  it('8. GET /api/v1/incidents filters by status=open|closed|all', async () => {
    incidentsStore = [
      {
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' as UUID,
        node_id: testNodeId,
        status: 'open',
        opened_at_ms: 1700000000000,
        closed_at_ms: null,
        peak_error_ms: 12.5,
        detection_latency_s: 1.2,
        cause: 'local_clock',
        summary: 'Clock drift detected',
        evidence: {},
      },
      {
        id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' as UUID,
        node_id: testNodeId,
        status: 'closed',
        opened_at_ms: 1699999000000,
        closed_at_ms: 1699999100000,
        peak_error_ms: 8.0,
        detection_latency_s: 2.0,
        cause: 'gnss_spoof',
        summary: 'GNSS anomaly resolved',
        evidence: {},
      },
    ];

    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator, db: mockDb });
    const resOpen = await request(app).get('/api/v1/incidents?status=open').expect(200);
    expect(resOpen.body.length).toBe(1);
    expect(resOpen.body[0].id).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

    // Filter closed
    const resClosed = await request(app).get('/api/v1/incidents?status=closed').expect(200);
    expect(resClosed.body.length).toBe(1);
    expect(resClosed.body[0].id).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');

    // Filter all
    const resAll = await request(app).get('/api/v1/incidents?status=all').expect(200);
    expect(resAll.body.length).toBe(2);
  });

  // 9. Incident limit validation works
  it('9. Incident query validates limit parameter', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    // Negative limit
    const resInvalid = await request(app).get('/api/v1/incidents?limit=-5').expect(400);
    expect(resInvalid.body.error.code).toBe('BAD_REQUEST');

    // Invalid status enum
    const resInvalidStatus = await request(app).get('/api/v1/incidents?status=unknown').expect(400);
    expect(resInvalidStatus.body.error.code).toBe('BAD_REQUEST');
  });

  // 10. GET /incidents/:id returns the correct record or not-found error
  it('10. GET /api/v1/incidents/:id returns full Incident contract or 404', async () => {
    const testIncidentId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' as UUID;
    incidentsStore = [
      {
        id: testIncidentId,
        node_id: testNodeId,
        status: 'open',
        opened_at_ms: 1700000000000,
        closed_at_ms: null,
        peak_error_ms: 15.0,
        detection_latency_s: 0.8,
        cause: 'network',
        summary: 'Network jitter spike',
        evidence: {
          assessments: [],
          chain_head_hash: 'headhash123',
          anchors: [],
          fault: null,
        },
      },
    ];

    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator, db: mockDb });

    const resFound = await request(app).get(`/api/v1/incidents/${testIncidentId}`).expect(200);
    expect(resFound.body.id).toBe(testIncidentId);
    expect(resFound.body.summary).toBe('Network jitter spike');
    expect(resFound.body.evidence.chain_head_hash).toBe('headhash123');

    // Not found
    const resMissing = await request(app).get('/api/v1/incidents/00000000-0000-4000-8000-000000000000').expect(404);
    expect(resMissing.body.error.code).toBe('NOT_FOUND');
  });

  // 11. GET /config returns the actual engine configuration
  it('11. GET /api/v1/config returns active engine configuration', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    const res = await request(app).get('/api/v1/config').expect(200);

    expect(res.body.tolerance_ms).toBe(DEFAULT_ENGINE_CONFIG.tolerance_ms);
    expect(res.body.z_suspect).toBe(DEFAULT_ENGINE_CONFIG.z_suspect);
    expect(res.body.cusum_k_sigma).toBe(DEFAULT_ENGINE_CONFIG.cusum_k_sigma);
  });

  // 12. PATCH /config applies valid partial updates
  it('12. PATCH /api/v1/config applies partial updates, mutates engine and returns updated config', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator, engine: stubEngine });

    const res = await request(app)
      .patch('/api/v1/config')
      .send({
        tolerance_ms: 25,
        z_suspect: 4.2,
      })
      .expect(200);

    expect(res.body.tolerance_ms).toBe(25);
    expect(res.body.z_suspect).toBe(4.2);
    // Unpatched fields remain untouched
    expect(res.body.cusum_k_sigma).toBe(DEFAULT_ENGINE_CONFIG.cusum_k_sigma);

    // Verify engine instance itself was mutated
    expect(stubEngine.getConfig().tolerance_ms).toBe(25);
    expect(stubEngine.getConfig().z_suspect).toBe(4.2);

    // Verify subsequent GET returns the updated configuration
    const resGet = await request(app).get('/api/v1/config').expect(200);
    expect(resGet.body.tolerance_ms).toBe(25);
    expect(resGet.body.z_suspect).toBe(4.2);
  });

  it('12b. GET and PATCH /api/v1/config return 503 SERVICE_UNAVAILABLE when engine is missing', async () => {
    const app = express();
    app.use(express.json());
    // Mount core routes WITHOUT engine
    app.use(createCoreRoutes(nodeRegistry, heartbeatService, orchestrator, undefined, mockDb));
    app.use(apiErrorMiddleware);

    const resGet = await request(app).get('/api/v1/config').expect(503);
    expect(resGet.body.error.code).toBe('INTERNAL');
    expect(resGet.body.error.message).toContain('Engine is not configured');

    const resPatch = await request(app)
      .patch('/api/v1/config')
      .send({ tolerance_ms: 20 })
      .expect(503);
    expect(resPatch.body.error.code).toBe('INTERNAL');
    expect(resPatch.body.error.message).toContain('Engine is not configured');
  });

  // 13. PATCH /config rejects invalid fields and values
  it('13. PATCH /api/v1/config rejects invalid fields, types and empty payloads', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    // Empty body
    const resEmpty = await request(app).patch('/api/v1/config').send({}).expect(400);
    expect(resEmpty.body.error.code).toBe('BAD_REQUEST');

    // Unknown field
    const resUnknown = await request(app)
      .patch('/api/v1/config')
      .send({ unknown_param: 999 })
      .expect(400);
    expect(resUnknown.body.error.code).toBe('BAD_REQUEST');

    // Invalid type (string instead of number)
    const resInvalidType = await request(app)
      .patch('/api/v1/config')
      .send({ tolerance_ms: 'invalid' })
      .expect(400);
    expect(resInvalidType.body.error.code).toBe('BAD_REQUEST');
  });

  // 14. GET /anchors returns the correct frozen type without claiming unavailable synchronization
  it('14. GET /api/v1/anchors returns AnchorInfo[] with ok=false for pre-T5 stub', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    const res = await request(app).get('/api/v1/anchors').expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body[0].host).toBeDefined();
    // Pre-T5: ok must be false
    expect(res.body[0].ok).toBe(false);
    expect(res.body[0].offset_ms).toBeNull();
  });

  // 15-18. Dashboard Socket.IO Subscription and snapshot tests
  describe('Dashboard Socket.IO Subscription (Part E2c)', () => {
    let serverHttp: HttpServer;
    let port: number;

    beforeEach(async () => {
      const serverInstance = createServer({ nodeRegistry, heartbeatService, orchestrator });
      serverHttp = serverInstance.server;

      await new Promise<void>((resolve) => {
        serverHttp.listen(0, () => {
          port = (serverHttp.address() as AddressInfo).port;
          resolve();
        });
      });
    });

    afterEach(async () => {
      if (serverHttp && serverHttp.listening) {
        await new Promise<void>((resolve) => serverHttp.close(() => resolve()));
      }
    });

    // 15. Dashboard authentication works without breaking node authentication
    it('15. connects dashboard client cleanly with role=dashboard auth', async () => {
      const client = ClientSocket(`http://localhost:${port}`, {
        auth: { role: 'dashboard' },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => {
          client.disconnect();
          resolve();
        });
        client.on('connect_error', reject);
      });
    });

    // 16. dashboard:subscribe acknowledges a valid Snapshot
    it('16. acknowledges dashboard:subscribe with canonical Snapshot', async () => {
      const client = ClientSocket(`http://localhost:${port}`, {
        auth: { role: 'dashboard' },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => {
          client.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE, {}, (ack: Snapshot) => {
            try {
              expect(ack).toBeDefined();
              expect(ack.contract_version).toBe(CONTRACT_VERSION);
              expect(ack.nodes.some((n) => n.id === testNodeId)).toBe(true);
              expect(SnapshotSchema.safeParse(ack).success).toBe(true);
              client.disconnect();
              resolve();
            } catch (e) {
              client.disconnect();
              reject(e);
            }
          });
        });
        client.on('connect_error', reject);
      });
    });

    // 17. snapshot is emitted after subscription
    it('17. emits snapshot event on server to dashboard after subscription', async () => {
      const client = ClientSocket(`http://localhost:${port}`, {
        auth: { role: 'dashboard' },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => {
          client.on(SOCKET_EVENTS.SNAPSHOT, (snapshot: Snapshot) => {
            try {
              expect(snapshot).toBeDefined();
              expect(snapshot.contract_version).toBe(CONTRACT_VERSION);
              expect(SnapshotSchema.safeParse(snapshot).success).toBe(true);
              client.disconnect();
              resolve();
            } catch (e) {
              client.disconnect();
              reject(e);
            }
          });

          client.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE);
        });
        client.on('connect_error', reject);
      });
    });

    // 18. Snapshot generation does not fabricate faults, baseline data or node metrics
    it('18. does not fabricate fake fault or baseline metrics in snapshot', async () => {
      const client = ClientSocket(`http://localhost:${port}`, {
        auth: { role: 'dashboard' },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => {
          client.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE, {}, (ack: Snapshot) => {
            try {
              expect(ack.faults).toEqual([]);
              expect(ack.baseline.per_node).toEqual([]);
              expect(ack.baseline.cluster_time_error_ms).toBe(0);
              client.disconnect();
              resolve();
            } catch (e) {
              client.disconnect();
              reject(e);
            }
          });
        });
        client.on('connect_error', reject);
      });
    });

    // Dashboard socket cannot perform node-only operations
    it('rejects node:join and heartbeat from dashboard-authenticated socket', async () => {
      const client = ClientSocket(`http://localhost:${port}`, {
        auth: { role: 'dashboard' },
        transports: ['websocket'],
      });

      await new Promise<void>((resolve, reject) => {
        client.on('connect', () => {
          client.emit(SOCKET_EVENTS.NODE_JOIN, { node_id: testNodeId }, (ack: { ok: boolean; error?: string }) => {
            try {
              expect(ack.ok).toBe(false);
              expect(ack.error).toBe('UNAUTHORIZED');

              // Also test heartbeat
              client.emit(SOCKET_EVENTS.HEARTBEAT, {} as unknown, (hbAck: { ok: boolean; code?: string }) => {
                try {
                  expect(hbAck.ok).toBe(false);
                  expect(hbAck.code).toBe('BAD_REQUEST');
                  client.disconnect();
                  resolve();
                } catch (e) {
                  client.disconnect();
                  reject(e);
                }
              });
            } catch (e) {
              client.disconnect();
              reject(e);
            }
          });
        });
        client.on('connect_error', reject);
      });
    });
  });

  // 19. Database and provider failures are surfaced correctly
  it('19. surfaces database failures on incidents endpoint gracefully', async () => {
    const errorDb: DatabaseRepositories = {
      ...mockDb,
      incidents: {
        listByStatus: vi.fn(async () => {
          throw new Error('Database query timed out');
        }),
        findById: vi.fn(async () => {
          throw new Error('Database query timed out');
        }),
        create: vi.fn(),
        update: vi.fn(),
      },
    } as unknown as DatabaseRepositories;

    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator, db: errorDb });

    const res = await request(app).get('/api/v1/incidents/cccccccc-cccc-4ccc-8ccc-cccccccccccc').expect(500);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('INTERNAL');
  });

  // 20. Existing Gateway tests remain green
  it('20. preserves health endpoint contract', async () => {
    const { app } = createServer({ nodeRegistry, heartbeatService, orchestrator });

    const res = await request(app).get('/api/v1/health').expect(200);

    expect(res.body.ok).toBe(true);
    expect(res.body.contract_version).toBe(CONTRACT_VERSION);
  });
});
