// TEST-FIXTURE
import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import {
  PassportSchema,
} from '@chronyx/contracts';
import type {
  UUID,
  Passport,
} from '@chronyx/contracts';
import { createCoreRoutes } from '../core/routes.js';
import { apiErrorMiddleware } from '../middleware/error.js';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';
import { Orchestrator } from '../core/orchestrator.js';
import { Engine } from '@chronyx/engine';
import type { DatabaseRepositories } from '../core/db/index.js';
import type { ObservationRow } from '../core/db/schema.js';
import { verifyHash, sha256hex, canonicalJson } from '@chronyx/crypto';

describe('Production Passport Endpoint (GET /api/v1/observations/:id/passport)', () => {
  let app: express.Express;
  let nodeRegistry: NodeRegistry;
  let heartbeatService: HeartbeatService;
  let stubEngine: Engine;
  let orchestrator: Orchestrator;
  let mockDb: DatabaseRepositories;
  let observationsStore: ObservationRow[];

  const testNodeId = '40d81060-ff0e-40db-9489-d6ff1ab19e1f' as UUID;
  const testNodePublicKey = 'KIz/dyk3NeeoCoqSzj43welGIxvfikqi0wUEJj22A3Q=';
  const testObservationId = '55555555-5555-4555-8555-555555555555' as UUID;

  beforeEach(async () => {
    nodeRegistry = new NodeRegistry();
    heartbeatService = new HeartbeatService(nodeRegistry);
    stubEngine = new Engine();

    const sampleObservation: ObservationRow = {
      id: testObservationId,
      node_id: testNodeId,
      kind: 'occultation_timing',
      observed_at_ms: 1700000000000,
      payload: { star: 'TYC 1234', duration_ms: 1540.5 },
      status: 'accepted',
      confidence: 0.95,
      state_at_ingest: 'trusted',
      created_at: new Date('2026-11-22T03:00:00.000Z').toISOString(),
    };
    observationsStore = [sampleObservation];

    mockDb = {
      observations: {
        findById: vi.fn(async (id: UUID) => observationsStore.find((o) => o.id === id) ?? null),
        list: vi.fn(async () => observationsStore),
        create: vi.fn(),
        updateStatus: vi.fn(),
        clearAll: vi.fn(),
      },
      nodes: {} as unknown as DatabaseRepositories['nodes'],
      heartbeats: {} as unknown as DatabaseRepositories['heartbeats'],
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

    await nodeRegistry.registerNode({
      id: testNodeId,
      name: 'Judge-Node-Live',
      kind: 'browser',
      public_key: testNodePublicKey,
    });

    app = express();
    app.use(express.json());
    app.use(createCoreRoutes(nodeRegistry, heartbeatService, orchestrator, stubEngine, mockDb));
    app.use(apiErrorMiddleware);
  });

  it('1. retrieves an existing observation and returns a valid Passport complying with frozen schema', async () => {
    const res = await request(app)
      .get(`/api/v1/observations/${testObservationId}/passport`)
      .expect(200);

    const parsed = PassportSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);

    const passport: Passport = res.body;
    expect(passport.observation_id).toBe(testObservationId);
    expect(passport.node_id).toBe(testNodeId);
    expect(passport.observed_at_ms).toBe(1700000000000);
    expect(passport.state_at_observation).toBe('trusted');
    expect(passport.confidence).toBe(0.95);
    expect(typeof passport.server_public_key).toBe('string');
    expect(typeof passport.sig).toBe('string');
  });

  it('2. verifies persisted provenance and cryptographic server signature', async () => {
    const res = await request(app)
      .get(`/api/v1/observations/${testObservationId}/passport`)
      .expect(200);

    const passport: Passport = res.body;

    // Verify evidence hash matches canonical observation payload
    const expectedEvidence = {
      observation_id: testObservationId,
      node_id: testNodeId,
      kind: 'occultation_timing',
      observed_at_ms: 1700000000000,
      payload: { star: 'TYC 1234', duration_ms: 1540.5 },
    };
    const expectedEvidenceHash = sha256hex(canonicalJson(expectedEvidence));
    expect(passport.evidence_hash).toBe(expectedEvidenceHash);

    // Verify certificate signature using @chronyx/crypto verifyHash
    const signedData = {
      observation_id: passport.observation_id,
      node_id: passport.node_id,
      observed_at_ms: passport.observed_at_ms,
      corrected_time_ms: passport.corrected_time_ms,
      error_est_ms: passport.error_est_ms,
      sigma_ms: passport.sigma_ms,
      confidence: passport.confidence,
      state_at_observation: passport.state_at_observation,
      evidence_hash: passport.evidence_hash,
      chain_head_hash: passport.chain_head_hash,
      issued_at_ms: passport.issued_at_ms,
      server_public_key: passport.server_public_key,
    };
    const certHash = sha256hex(canonicalJson(signedData));
    const isValid = await verifyHash(certHash, passport.sig, passport.server_public_key);
    expect(isValid).toBe(true);
  });

  it('3. returns 404 NOT_FOUND for nonexistent observation ID', async () => {
    const missingId = '00000000-0000-0000-0000-000000000099';
    const res = await request(app)
      .get(`/api/v1/observations/${missingId}/passport`)
      .expect(404);

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(res.body.error.message).toContain(missingId);
  });

  it('4. returns 400 BAD_REQUEST for invalid UUID format', async () => {
    const res = await request(app)
      .get('/api/v1/observations/not-a-valid-uuid/passport')
      .expect(400);

    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('BAD_REQUEST');
    expect(res.body.error.message).toContain('Invalid observation ID');
  });

  it('5. returns 500 INTERNAL if database persistence is unavailable', async () => {
    const noDbApp = express();
    noDbApp.use(express.json());
    noDbApp.use(createCoreRoutes(nodeRegistry, heartbeatService, orchestrator, stubEngine, null));
    noDbApp.use(apiErrorMiddleware);

    const res = await request(noDbApp)
      .get(`/api/v1/observations/${testObservationId}/passport`)
      .expect(500);

    expect(res.body.error.code).toBe('INTERNAL');
    expect(res.body.error.message).toContain('Database persistence');
  });
});
