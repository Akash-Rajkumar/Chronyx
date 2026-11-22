import { Router } from 'express';
import { z } from 'zod';
import {
  CONTRACT_VERSION,
  ROUTES,
  RegisterNodeReqSchema,
  HeartbeatSchema,
  NodeHistoryQuerySchema,
  IncidentsQuerySchema,
  PatchConfigReqSchema,
  ObservationCreateSchema,
  ObservationSchema,
  PassportSchema,
} from '@chronyx/contracts';
import type {
  HistoryPoint,
  AnchorInfo,
  IncidentSummary,
  Incident,
  IEngine,
  SuspectedCause,
  Observation,
  ObservationStatus,
  Passport,
  TrustState,
  UUID,
} from '@chronyx/contracts';
import { sha256hex, canonicalJson, signHash } from '@chronyx/crypto';
import { getServerKeyPair } from './serverKey.js';
import { isDbConfigured } from './db/index.js';
import { NodeRegistry } from './nodeRegistry.js';
import { HeartbeatService } from './heartbeatService.js';
import type { Orchestrator } from './orchestrator.js';
import type { DatabaseRepositories } from './db/index.js';
import { buildSnapshot } from './snapshot.js';
import { AppError } from '../middleware/error.js';

export function createCoreRoutes(
  nodeRegistry: NodeRegistry = new NodeRegistry(),
  heartbeatService: HeartbeatService = new HeartbeatService(nodeRegistry),
  orchestrator?: Orchestrator,
  engine?: IEngine,
  db?: DatabaseRepositories | null,
): Router {
  const router = Router();

  // GET /api/v1/health (Part E2b)
  router.get(ROUTES.HEALTH, (_req, res) => {
    res.json({
      ok: true,
      contract_version: CONTRACT_VERSION,
      server_time_ms: Date.now(),
      db: isDbConfigured() ? 'up' : 'down',
      anchors_ok: false,
    });
  });

  // GET /api/v1/state (Part E2b)
  router.get(ROUTES.STATE, async (_req, res, next) => {
    try {
      const snapshot = await buildSnapshot(nodeRegistry, orchestrator, engine, db);
      res.json(snapshot);
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/nodes/register (Part E2b)
  router.post(ROUTES.NODES_REGISTER, async (req, res, next) => {
    try {
      const parsed = RegisterNodeReqSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid node registration request', 400, parsed.error.issues);
      }

      const node = await nodeRegistry.registerNode(parsed.data);
      res.status(201).json({
        node,
        hub_time_ms: Date.now(),
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/nodes (Part E2b)
  router.get(ROUTES.NODES, (_req, res) => {
    const nodes = nodeRegistry.getAllNodes();
    res.json(nodes);
  });

  // GET /api/v1/nodes/:id (Part E2b)
  router.get('/api/v1/nodes/:id', async (req, res, next) => {
    try {
      const node = await nodeRegistry.getNode(req.params.id);
      if (!node) {
        throw new AppError('NOT_FOUND', `Node ${req.params.id} not found`, 404);
      }
      const assessment = orchestrator?.getLatestAssessment(node.id) ?? null;
      res.json({
        node,
        assessment,
      });
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/nodes/:id/history (Part E2b)
  router.get('/api/v1/nodes/:id/history', async (req, res, next) => {
    try {
      const node = await nodeRegistry.getNode(req.params.id);
      if (!node) {
        throw new AppError('NOT_FOUND', `Node ${req.params.id} not found`, 404);
      }

      const parsed = NodeHistoryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid history query parameters', 400, parsed.error.issues);
      }

      const windowS = parsed.data.window_s;
      const samples = nodeRegistry.getHistory(node.id, windowS);
      const latestAssessment = orchestrator?.getLatestAssessment(node.id);

      // If no assessment exists for this node, return empty history points
      // (Never synthesize fake confidence: 1.0, state: 'trusted', or sigma_ms: 0.25)
      if (!latestAssessment) {
        res.json({ points: [] });
        return;
      }

      const points: HistoryPoint[] = samples.map((sample) => {
        const streams: Partial<Record<'peer' | 'oscillator', number>> = {};
        if (sample.peer_offset_ms !== null) {
          streams.peer = sample.peer_offset_ms;
        }
        if (sample.osc_residual_ms !== null) {
          streams.oscillator = sample.osc_residual_ms;
        }

        return {
          t_ms: sample.server_rx_ms,
          error_est_ms: latestAssessment.error_est_ms,
          sigma_ms: latestAssessment.sigma_ms,
          confidence: latestAssessment.confidence,
          state: latestAssessment.state,
          streams,
          injected_error_ms: null,
        };
      });

      res.json({ points });
    } catch (err) {
      next(err);
    }
  });

  // POST /api/v1/heartbeats (Part E2b)
  router.post(ROUTES.HEARTBEATS, async (req, res, next) => {
    try {
      const parsed = HeartbeatSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({
          ok: false,
          code: 'BAD_REQUEST',
        });
        return;
      }

      const ack = await heartbeatService.verifyAndIngest(parsed.data, Date.now());
      res.json(ack);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/incidents (Part E2b)
  router.get(ROUTES.INCIDENTS, async (req, res, next) => {
    try {
      const parsed = IncidentsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid incidents query parameters', 400, parsed.error.issues);
      }

      const { status, limit } = parsed.data;
      let incidents: IncidentSummary[] = [];

      if (db) {
        const rows = await db.incidents.listByStatus(status, limit);
        incidents = rows.map((row) => ({
          id: row.id,
          node_id: row.node_id,
          node_name: nodeRegistry.getNodeSync(row.node_id)?.name ?? 'Unknown Node',
          status: row.status as 'open' | 'closed',
          opened_at_ms: row.opened_at_ms,
          closed_at_ms: row.closed_at_ms,
          peak_error_ms: row.peak_error_ms,
          detection_latency_s: row.detection_latency_s,
          cause: row.cause as SuspectedCause,
        }));
      }

      res.json(incidents);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/incidents/:id (Part E2b)
  router.get('/api/v1/incidents/:id', async (req, res, next) => {
    try {
      if (!db) {
        throw new AppError('NOT_FOUND', `Incident ${req.params.id} not found`, 404);
      }

      const row = await db.incidents.findById(req.params.id);
      if (!row) {
        throw new AppError('NOT_FOUND', `Incident ${req.params.id} not found`, 404);
      }

      const evidence = (row.evidence as Record<string, unknown>) ?? {};

      const timeline = Array.isArray(evidence.timeline) ? (evidence.timeline as Incident['timeline']) : [];
      const assessments = Array.isArray(evidence.assessments) ? (evidence.assessments as Incident['evidence']['assessments']) : [];
      const anchors = Array.isArray(evidence.anchors) ? (evidence.anchors as Incident['evidence']['anchors']) : [];
      const fault = (evidence.fault as Incident['evidence']['fault']) ?? null;

      const incident: Incident = {
        id: row.id,
        node_id: row.node_id,
        node_name: nodeRegistry.getNodeSync(row.node_id)?.name ?? 'Unknown Node',
        status: row.status as 'open' | 'closed',
        opened_at_ms: row.opened_at_ms,
        closed_at_ms: row.closed_at_ms,
        peak_error_ms: row.peak_error_ms,
        detection_latency_s: row.detection_latency_s,
        cause: row.cause as SuspectedCause,
        summary: row.summary,
        timeline,
        evidence: {
          assessments,
          chain_head_hash: typeof evidence.chain_head_hash === 'string' ? evidence.chain_head_hash : '',
          anchors,
          fault,
        },
      };

      res.json(incident);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/config (Part E2b)
  router.get(ROUTES.CONFIG, (_req, res, next) => {
    try {
      if (!engine) {
        throw new AppError('INTERNAL', 'Engine is not configured or unavailable', 503);
      }
      const config = engine.getConfig();
      res.json(config);
    } catch (err) {
      next(err);
    }
  });

  // PATCH /api/v1/config (Part E2b)
  router.patch(ROUTES.CONFIG, (req, res, next) => {
    try {
      if (!engine) {
        throw new AppError('INTERNAL', 'Engine is not configured or unavailable', 503);
      }

      if (!req.body || typeof req.body !== 'object' || Object.keys(req.body).length === 0) {
        throw new AppError('BAD_REQUEST', 'Config patch body cannot be empty', 400);
      }

      const parsed = PatchConfigReqSchema.strict().safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid config patch payload', 400, parsed.error.issues);
      }

      engine.setConfig(parsed.data);
      const updated = engine.getConfig();
      res.json(updated);
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/anchors (Part E2b pre-T5 stub)
  router.get(ROUTES.ANCHORS, (_req, res) => {
    const anchors: AnchorInfo[] = [
      {
        host: 'time.nplindia.org',
        offset_ms: null,
        rtt_ms: null,
        ok: false,
        sampled_at_ms: Date.now(),
      },
    ];
    res.json(anchors);
  });

  // POST /api/v1/observations (Part E2b)
  router.post(ROUTES.OBSERVATIONS, async (req, res, next) => {
    try {
      const parsed = ObservationCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new AppError('BAD_REQUEST', 'Invalid observation payload', 400, parsed.error.issues);
      }

      if (!db) {
        throw new AppError('INTERNAL', 'Database persistence is not configured or unavailable', 500);
      }

      const node = await nodeRegistry.getNode(parsed.data.node_id);
      if (!node) {
        throw new AppError('NOT_FOUND', `Node ${parsed.data.node_id} not found`, 404);
      }

      const assessment = orchestrator?.getLatestAssessment(parsed.data.node_id);

      // Zero-trust policy: unassessed nodes must never be defaulted to 'trusted' with 1.0 confidence.
      // Unassessed observations must be held pending engine evaluation.
      const state_at_ingest: TrustState = assessment?.state ?? 'suspect';
      const confidence: number = assessment?.confidence ?? 0.0;

      let status: ObservationStatus = 'accepted';
      if (!assessment) {
        status = 'held';
      } else if (state_at_ingest === 'suspect' || state_at_ingest === 'recovering') {
        status = 'held';
      } else if (state_at_ingest === 'quarantined') {
        status = 'rejected';
      } else {
        status = 'accepted';
      }

      const row = await db.observations.create({
        node_id: parsed.data.node_id as UUID,
        kind: parsed.data.kind,
        observed_at_ms: parsed.data.observed_at_ms,
        payload: parsed.data.payload as unknown as import('./db/schema.js').Json,
        status,
        confidence,
        state_at_ingest,
      });

      const response: Observation = {
        id: row.id,
        node_id: row.node_id,
        kind: row.kind,
        observed_at_ms: row.observed_at_ms,
        payload: (row.payload as Record<string, unknown>) ?? {},
        status: row.status,
        confidence: row.confidence,
        state_at_ingest: row.state_at_ingest,
        created_at: typeof row.created_at === 'string' ? row.created_at : new Date(row.created_at).toISOString(),
      };

      res.status(201).json(ObservationSchema.parse(response));
    } catch (err) {
      next(err);
    }
  });

  // GET /api/v1/observations/:id/passport (Part E2b / Part G4.9)
  router.get('/api/v1/observations/:id/passport', async (req, res, next) => {
    try {
      const observationId = req.params.id;
      const uuidCheck = z.string().uuid().safeParse(observationId);
      if (!uuidCheck.success) {
        throw new AppError('BAD_REQUEST', `Invalid observation ID: ${observationId}`, 400);
      }

      if (!db) {
        throw new AppError('INTERNAL', 'Database persistence is not configured or unavailable', 500);
      }

      const observation = await db.observations.findById(observationId as UUID);
      if (!observation) {
        throw new AppError('NOT_FOUND', `Observation ${observationId} not found`, 404);
      }

      const assessment = orchestrator?.getLatestAssessment(observation.node_id);
      const chain_head_hash = nodeRegistry.getLastVerifiedHash(observation.node_id);

      const error_est_ms = assessment?.error_est_ms ?? 0;
      const corrected_time_ms = Number((observation.observed_at_ms - error_est_ms).toFixed(2));
      const sigma_ms =
        assessment?.sigma_ms && assessment.sigma_ms > 0
          ? Number(assessment.sigma_ms.toFixed(2))
          : 0.1;
      const confidence = assessment?.confidence ?? observation.confidence;
      const state_at_observation: TrustState =
        observation.state_at_ingest ?? assessment?.state ?? 'trusted';

      const evidencePayload = {
        observation_id: observation.id,
        node_id: observation.node_id,
        kind: observation.kind,
        observed_at_ms: observation.observed_at_ms,
        payload: observation.payload,
      };
      const evidence_hash = sha256hex(canonicalJson(evidencePayload));
      const issued_at_ms = Date.now();

      const serverKeys = await getServerKeyPair();
      const server_public_key = serverKeys.publicKeyBase64;

      const passportDataToSign = {
        observation_id: observation.id,
        node_id: observation.node_id,
        observed_at_ms: observation.observed_at_ms,
        corrected_time_ms,
        error_est_ms,
        sigma_ms,
        confidence,
        state_at_observation,
        evidence_hash,
        chain_head_hash,
        issued_at_ms,
        server_public_key,
      };
      const certHash = sha256hex(canonicalJson(passportDataToSign));
      const sig = await signHash(certHash, serverKeys.privateKey);

      const passport: Passport = {
        observation_id: observation.id,
        node_id: observation.node_id,
        observed_at_ms: observation.observed_at_ms,
        corrected_time_ms,
        error_est_ms,
        sigma_ms,
        confidence,
        state_at_observation,
        evidence_hash,
        chain_head_hash,
        issued_at_ms,
        server_public_key,
        sig,
      };

      res.json(PassportSchema.parse(passport));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
