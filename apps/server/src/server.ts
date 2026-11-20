import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { createEngine } from '@chronyx/engine';
import { createSim } from '@chronyx/sim';
import { createCoreRoutes } from './core/routes.js';
import { registerLabRoutes } from './lab/index.js';
import { apiErrorMiddleware } from './middleware/error.js';
import type { LabContext, IFaultService } from './ctx.js';

export function createServer() {
  const app = express();
  const server = http.createServer(app);

  const webOrigin = process.env.WEB_ORIGIN || 'http://localhost:5173';

  app.use(
    cors({
      origin: webOrigin,
      credentials: true,
    }),
  );
  app.use(express.json());

  const io = new SocketIOServer(server, {
    cors: {
      origin: webOrigin,
      methods: ['GET', 'POST'],
      credentials: true,
    },
  });

  // Mount Core Routes
  app.use(createCoreRoutes());

  // Setup Lab Context seam
  const engine = createEngine();
  const sim = createSim();

  const faultServiceStub: IFaultService = {
    start: async (spec) => ({
      ...spec,
      id: '00000000-0000-0000-0000-000000000000',
      started_at_ms: Date.now(),
      ends_at_ms: null,
      status: 'active',
      applies_to: 'sim',
      detected_at_ms: null,
      error_at_detect_ms: null,
      detection_latency_s: null,
    }),
    stop: async (id) => ({
      id,
      node_id: '00000000-0000-0000-0000-000000000000',
      type: 'clock_step',
      params: {},
      started_at_ms: Date.now(),
      ends_at_ms: Date.now(),
      status: 'stopped',
      applies_to: 'sim',
      detected_at_ms: null,
      error_at_detect_ms: null,
      detection_latency_s: null,
    }),
    active: () => [],
    injectedErrorMs: () => 0,
    markDetected: async () => {},
  };

  const labContext: LabContext = {
    now: () => Date.now(),
    hubNow: () => performance.now(),
    engine,
    sim,
    faults: faultServiceStub,
    db: null,
    emit: (event, payload) => io.to('dashboard').emit(event, payload),
    sendToNode: (_node_id, _event, _payload) => {},
    getAssessments: () => [],
    getNodes: () => [],
    getBaselineInputs: () => [],
  };

  registerLabRoutes(app, labContext);

  // If USE_MOCKS=1 is enabled, wire mock routes & socket feed
  if (process.env.USE_MOCKS === '1') {
    // Dynamic import to isolate mock module if needed
    import('./mocks/mockService.js').then(({ setupMockServer }) => {
      setupMockServer(app, io);
    });
  }

  // Error handling middleware
  app.use(apiErrorMiddleware);

  return { app, server, io };
}
