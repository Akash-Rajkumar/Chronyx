import { Router } from 'express';
import { CONTRACT_VERSION, ROUTES } from '@chronyx/contracts';
import { isDbConfigured } from './db/index.js';

export function createCoreRoutes(): Router {
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

  return router;
}
