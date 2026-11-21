import { Router } from 'express';
import {
  CONTRACT_VERSION,
  ROUTES,
  RegisterNodeReqSchema,
  HeartbeatSchema,
} from '@chronyx/contracts';
import { isDbConfigured } from './db/index.js';
import { NodeRegistry } from './nodeRegistry.js';
import { HeartbeatService } from './heartbeatService.js';
import { AppError } from '../middleware/error.js';

export function createCoreRoutes(
  nodeRegistry: NodeRegistry = new NodeRegistry(),
  heartbeatService: HeartbeatService = new HeartbeatService(nodeRegistry),
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
      res.json({
        node,
        assessment: null,
      });
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

  return router;
}
