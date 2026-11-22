// TEST-FIXTURE
import { describe, it, expect, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { ROUTES, JoinInfoSchema } from '@chronyx/contracts';
import type { JoinInfo } from '@chronyx/contracts';
import { createCoreRoutes } from '../core/routes.js';
import { apiErrorMiddleware } from '../middleware/error.js';
import { NodeRegistry } from '../core/nodeRegistry.js';
import { HeartbeatService } from '../core/heartbeatService.js';

describe('Production Join Info Route (GET /api/v1/join-info)', () => {
  let app: express.Express;
  let nodeRegistry: NodeRegistry;
  let heartbeatService: HeartbeatService;

  beforeEach(() => {
    nodeRegistry = new NodeRegistry();
    heartbeatService = new HeartbeatService(nodeRegistry);

    app = express();
    app.use(express.json());
    app.use(createCoreRoutes(nodeRegistry, heartbeatService));
    app.use(apiErrorMiddleware);
  });

  it('1. returns HTTP 200 and schema-valid JoinInfo with join_url, ws_url, and api_url', async () => {
    const res = await request(app)
      .get(ROUTES.JOIN_INFO)
      .expect(200);

    const parsed = JoinInfoSchema.safeParse(res.body);
    expect(parsed.success).toBe(true);

    const joinInfo: JoinInfo = res.body;
    expect(joinInfo.join_url).toContain('/join');
    expect(joinInfo.ws_url).toMatch(/^http:\/\//);
    expect(joinInfo.api_url).toMatch(/^http:\/\//);
  });

  it('2. preserves configured WEB_ORIGIN in join_url', async () => {
    const origWebOrigin = process.env.WEB_ORIGIN;
    try {
      process.env.WEB_ORIGIN = 'http://192.168.1.100:5173';
      const res = await request(app)
        .get(ROUTES.JOIN_INFO)
        .expect(200);

      const joinInfo: JoinInfo = res.body;
      expect(joinInfo.join_url).toBe('http://192.168.1.100:5173/join');
    } finally {
      process.env.WEB_ORIGIN = origWebOrigin;
    }
  });

  it('3. respects x-forwarded-proto and host headers for reverse proxies and LAN access', async () => {
    const res = await request(app)
      .get(ROUTES.JOIN_INFO)
      .set('x-forwarded-proto', 'https')
      .set('host', 'observatory.chronyx.lan:8443')
      .expect(200);

    const joinInfo: JoinInfo = res.body;
    expect(joinInfo.ws_url).toBe('https://observatory.chronyx.lan:8443');
    expect(joinInfo.api_url).toBe('https://observatory.chronyx.lan:8443');
  });
});
