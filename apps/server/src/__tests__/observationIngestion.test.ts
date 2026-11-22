// TEST-FIXTURE
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  ROUTES,
  ObservationSchema,
} from '@chronyx/contracts';
import type {
  UUID,
  ObservationCreate,
  Assessment,
} from '@chronyx/contracts';
import { createCoreRoutes } from '../core/routes.js';
import { apiErrorMiddleware } from '../middleware/error.js';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';
import { Orchestrator } from '../core/orchestrator.js';
import { Engine } from '@chronyx/engine';
import type { DatabaseRepositories } from '../core/db/index.js';
import type { ObservationInsert, ObservationRow } from '../core/db/schema.js';

describe('P1-T9-C Observation Ingestion Route Suite (POST /api/v1/observations)', () => {
  let app: express.Express;
  let nodeRegistry: NodeRegistry;
  let heartbeatService: HeartbeatService;
  let stubEngine: Engine;
  let orchestrator: Orchestrator;
  let mockDb: DatabaseRepositories;
  let observationsStore: ObservationRow[];

  const testNodeId = '40d81060-ff0e-40db-9489-d6ff1ab19e1f' as UUID;
  const testNodePublicKey = 'KIz/dyk3NeeoCoqSzj43welGIxvfikqi0wUEJj22A3Q=';

  beforeEach(async () => {
    nodeRegistry = new NodeRegistry();
    heartbeatService = new HeartbeatService(nodeRegistry);
    stubEngine = new Engine();
    observationsStore = [];

    mockDb = {
      incidents: {
        listByStatus: vi.fn(async () => []),
        findById: vi.fn(async () => null),
        create: vi.fn(),
        update: vi.fn(),
      },
      assessments: {
        create: vi.fn(),
        listByNode: vi.fn(async () => []),
      },
      transitions: {
        create: vi.fn(),
        listByNode: vi.fn(async () => []),
      },
      observations: {
        create: vi.fn(async (data: ObservationInsert): Promise<ObservationRow> => {
          const row: ObservationRow = {
            id: '55555555-5555-4555-8555-555555555555' as UUID,
            node_id: data.node_id,
            kind: data.kind,
            observed_at_ms: data.observed_at_ms,
            payload: data.payload ?? {},
            status: data.status,
            confidence: data.confidence,
            state_at_ingest: data.state_at_ingest,
            created_at: new Date('2026-11-22T03:00:00.000Z').toISOString(),
          };
          observationsStore.push(row);
          return row;
        }),
        findById: vi.fn(async (id: UUID) => observationsStore.find((o) => o.id === id) ?? null),
        list: vi.fn(async () => observationsStore),
        updateStatus: vi.fn(),
        clearAll: vi.fn(),
      },
      nodes: {} as unknown as DatabaseRepositories['nodes'],
      heartbeats: {} as unknown as DatabaseRepositories['heartbeats'],
      faults: {} as unknown as DatabaseRepositories['faults'],
      benchmarkRuns: {} as unknown as DatabaseRepositories['benchmarkRuns'],
      anchors: {} as unknown as DatabaseRepositories['anchors'],
      config: {} as unknown as DatabaseRepositories['config'],
    } as unknown as DatabaseRepositories;

    orchestrator = new Orchestrator({
      nodeRegistry,
      engine: stubEngine,
      db: mockDb,
    });

    // Register active test node in node registry
    await nodeRegistry.registerNode({
      id: testNodeId,
      name: 'Judge-P3-T9B-2216',
      kind: 'browser',
      public_key: testNodePublicKey,
    });

    app = express();
    app.use(express.json());
    app.use(createCoreRoutes(nodeRegistry, heartbeatService, orchestrator, stubEngine, mockDb));
    app.use(apiErrorMiddleware);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // 1. Valid observation creation and zero-trust assessment state reflection
  it('1a. Unassessed node is held with confidence 0.0 and state_at_ingest suspect', async () => {
    // No assessment exists for testNodeId in orchestrator
    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'occultation_timing',
      observed_at_ms: 1795296674428,
      payload: {
        chord_ms: 350.5,
        star: 'TYC-2938-102',
      },
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(201);

    expect(res.body.id).toBe('55555555-5555-4555-8555-555555555555');
    expect(res.body.node_id).toBe(testNodeId);
    expect(res.body.kind).toBe('occultation_timing');
    expect(res.body.observed_at_ms).toBe(1795296674428);
    expect(res.body.payload).toEqual({ chord_ms: 350.5, star: 'TYC-2938-102' });
    expect(res.body.status).toBe('held');
    expect(res.body.confidence).toBe(0.0);
    expect(res.body.state_at_ingest).toBe('suspect');
    expect(res.body.created_at).toBe('2026-11-22T03:00:00.000Z');

    // Verify DB persistence was called with expected fields
    expect(mockDb.observations.create).toHaveBeenCalledTimes(1);
    expect(mockDb.observations.create).toHaveBeenCalledWith({
      node_id: testNodeId,
      kind: 'occultation_timing',
      observed_at_ms: 1795296674428,
      payload: { chord_ms: 350.5, star: 'TYC-2938-102' },
      status: 'held',
      confidence: 0.0,
      state_at_ingest: 'suspect',
    });
  });

  it('1b. Trusted node is accepted with its actual assessment confidence', async () => {
    vi.spyOn(orchestrator, 'getLatestAssessment').mockReturnValue({
      node_id: testNodeId,
      state: 'trusted',
      confidence: 0.98,
      error_est_ms: 0.15,
      sigma_ms: 0.22,
      offset_sd_ms: 0.1,
      drift_ppm: 0.2,
      drift_sd_ppm: 0.05,
      last_seen_ms: Date.now(),
      streams: [],
      cusum_pos: 0,
      cusum_neg: 0,
    } as unknown as Assessment);

    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'occultation_timing',
      observed_at_ms: 1795296674428,
      payload: { chord_ms: 350.5, star: 'TYC-2938-102' },
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(201);

    expect(res.body.status).toBe('accepted');
    expect(res.body.confidence).toBe(0.98);
    expect(res.body.state_at_ingest).toBe('trusted');
  });

  // 2. Invalid request payload
  it('2a. Rejects missing required fields with HTTP 400 and BAD_REQUEST ApiError', async () => {
    const invalidPayload = {
      node_id: testNodeId,
      // kind missing
      observed_at_ms: 1795296674428,
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(invalidPayload)
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toContain('Invalid observation payload');
    expect(Array.isArray(res.body.error.details)).toBe(true);
    expect(mockDb.observations.create).not.toHaveBeenCalled();
  });

  it('2b. Rejects invalid UUID in node_id with HTTP 400', async () => {
    const invalidPayload = {
      node_id: 'not-a-valid-uuid',
      kind: 'generic',
      observed_at_ms: 1795296674428,
      payload: {},
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(invalidPayload)
      .expect(400);

    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(mockDb.observations.create).not.toHaveBeenCalled();
  });

  it('2c. Rejects non-existent node with HTTP 404 and NOT_FOUND ApiError', async () => {
    const unregisteredNodeId = '99999999-9999-4999-8999-999999999999';
    const payload = {
      node_id: unregisteredNodeId,
      kind: 'generic',
      observed_at_ms: 1795296674428,
      payload: {},
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(404);

    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain(`Node ${unregisteredNodeId} not found`);
    expect(mockDb.observations.create).not.toHaveBeenCalled();
  });

  // 3. Persistence failure
  it('3a. Returns HTTP 500 with INTERNAL code when database persistence throws', async () => {
    vi.mocked(mockDb.observations.create).mockRejectedValueOnce(
      new Error('Supabase connection pool exhausted'),
    );

    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'generic',
      observed_at_ms: 1795296674428,
      payload: { sensor: 'photometer-1' },
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(500);

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.message).toBe('Supabase connection pool exhausted');
  });

  it('3b. Returns HTTP 500 when database layer is unconfigured (db = null)', async () => {
    const noDbApp = express();
    noDbApp.use(express.json());
    noDbApp.use(createCoreRoutes(nodeRegistry, heartbeatService, orchestrator, stubEngine, null));
    noDbApp.use(apiErrorMiddleware);

    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'generic',
      observed_at_ms: 1795296674428,
      payload: {},
    };

    const res = await request(noDbApp)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(500);

    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.message).toContain('Database persistence is not configured');
  });

  // 4. Correct route prefix and HTTP method
  it('4a. Confirms exact route is /api/v1/observations', async () => {
    expect(ROUTES.OBSERVATIONS).toBe('/api/v1/observations');

    // Confirm that hitting without prefix gives 404
    await request(app).post('/observations').send({}).expect(404);
  });

  it('4b. Disallows unsupported HTTP methods like PUT or DELETE on /api/v1/observations', async () => {
    await request(app).put(ROUTES.OBSERVATIONS).send({}).expect(404);
    await request(app).delete(ROUTES.OBSERVATIONS).send({}).expect(404);
  });

  // 5. Response contract compliance
  it('5. Response strictly complies with frozen ObservationSchema', async () => {
    vi.spyOn(orchestrator, 'getLatestAssessment').mockReturnValue({
      node_id: testNodeId,
      state: 'trusted',
      confidence: 0.99,
      error_est_ms: 0.08,
      sigma_ms: 0.15,
      offset_sd_ms: 0.05,
      drift_ppm: 0.1,
      drift_sd_ppm: 0.02,
      last_seen_ms: Date.now(),
      streams: [],
      cusum_pos: 0,
      cusum_neg: 0,
    } as unknown as Assessment);

    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'occultation_timing',
      observed_at_ms: 1795296674428,
      payload: { chord_ms: 412.3 },
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(201);

    // Strict validation against frozen ObservationSchema
    const parseResult = ObservationSchema.safeParse(res.body);
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      const obs = parseResult.data;
      expect(obs.id).toBe('55555555-5555-4555-8555-555555555555');
      expect(obs.node_id).toBe(testNodeId);
      expect(obs.kind).toBe('occultation_timing');
      expect(obs.observed_at_ms).toBe(1795296674428);
      expect(obs.status).toBe('accepted');
      expect(obs.confidence).toBe(0.99);
      expect(obs.state_at_ingest).toBe('trusted');
      expect(obs.created_at).toBe('2026-11-22T03:00:00.000Z');
    }
  });

  // 6. Assessment state reflection (quarantined, suspect, and recovering states)
  it('6a. Correctly marks observation as rejected when node state is quarantined', async () => {
    // Mock latest assessment as quarantined
    vi.spyOn(orchestrator, 'getLatestAssessment').mockReturnValue({
      node_id: testNodeId,
      state: 'quarantined',
      confidence: 0.1,
      error_est_ms: 120.5,
      sigma_ms: 15.0,
      offset_sd_ms: 5.0,
      drift_ppm: 25.0,
      drift_sd_ppm: 2.0,
      last_seen_ms: Date.now(),
      streams: [],
      cusum_pos: 10,
      cusum_neg: 0,
    } as unknown as Assessment);

    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'generic',
      observed_at_ms: 1795296674428,
      payload: {},
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(201);

    expect(res.body.status).toBe('rejected');
    expect(res.body.state_at_ingest).toBe('quarantined');
    expect(res.body.confidence).toBe(0.1);
  });

  it('6b. Correctly marks observation as held when node state is suspect', async () => {
    // Mock latest assessment as suspect
    vi.spyOn(orchestrator, 'getLatestAssessment').mockReturnValue({
      node_id: testNodeId,
      state: 'suspect',
      confidence: 0.65,
      error_est_ms: 45.0,
      sigma_ms: 8.0,
      offset_sd_ms: 3.0,
      drift_ppm: 10.0,
      drift_sd_ppm: 1.0,
      last_seen_ms: Date.now(),
      streams: [],
      cusum_pos: 4,
      cusum_neg: 0,
    } as unknown as Assessment);

    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'generic',
      observed_at_ms: 1795296674428,
      payload: {},
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(201);

    expect(res.body.status).toBe('held');
    expect(res.body.state_at_ingest).toBe('suspect');
    expect(res.body.confidence).toBe(0.65);
  });

  it('6c. Correctly marks observation as held when node state is recovering', async () => {
    // Mock latest assessment as recovering
    vi.spyOn(orchestrator, 'getLatestAssessment').mockReturnValue({
      node_id: testNodeId,
      state: 'recovering',
      confidence: 0.82,
      error_est_ms: 8.0,
      sigma_ms: 1.2,
      offset_sd_ms: 0.5,
      drift_ppm: 0.8,
      drift_sd_ppm: 0.1,
      last_seen_ms: Date.now(),
      streams: [],
      cusum_pos: 1,
      cusum_neg: 0,
    } as unknown as Assessment);

    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'generic',
      observed_at_ms: 1795296674428,
      payload: {},
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(201);

    expect(res.body.status).toBe('held');
    expect(res.body.state_at_ingest).toBe('recovering');
    expect(res.body.confidence).toBe(0.82);
  });

  // 7. Security boundary enforcement (D-003): node registration validated, no HTTP signature required
  it('7. Enforces node registration and schema validation on REST without requiring HTTP Ed25519 signature headers (demo boundary)', async () => {
    // Valid registered node submitting without any Auth or signature headers
    const payload: ObservationCreate = {
      node_id: testNodeId,
      kind: 'occultation_timing',
      observed_at_ms: 1795296680000,
      payload: {
        raw_measurement: 42.1,
      },
    };

    const res = await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send(payload)
      .expect(201);

    expect(res.body.node_id).toBe(testNodeId);
    expect(res.body.status).toBe('held'); // unassessed node defaults to held per zero-trust policy

    // Unregistered node UUID is rejected with 404 NOT_FOUND
    const unregisteredNodeId = 'e0000000-0000-4000-8000-000000000099' as UUID;
    await request(app)
      .post(ROUTES.OBSERVATIONS)
      .send({ ...payload, node_id: unregisteredNodeId })
      .expect(404);
  });
});
