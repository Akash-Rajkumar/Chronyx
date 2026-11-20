// MOCK-DATA (remove before main)
import type { Express } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import {
  ROUTES,
  SOCKET_EVENTS,
  mockSnapshot,
  mockJoinInfo,
  mockNodeInfo,
  mockAssessment,
  mockHistoryPoint,
  mockHeartbeatAck,
  mockAnchorInfo,
  mockIncidentSummary,
  mockIncident,
  mockObservation,
  mockPassport,
  mockFault,
  mockBaselineState,
  mockScienceReplayRes,
  mockBenchmarkRun,
  mockLiveMetrics,
} from '@chronyx/contracts';
import { logger } from '../logger.js';

/**
 * Configures mock routes and socket feeds when USE_MOCKS=1.
 */
export function setupMockServer(app: Express, io: SocketIOServer): void {
  logger.info('USE_MOCKS=1 detected: Mounting mock route handlers and 1 Hz simulated socket feed');

  // Core Mocks
  app.get(ROUTES.STATE, (_req, res) => {
    res.json(mockSnapshot);
  });

  app.get(ROUTES.JOIN_INFO, (_req, res) => {
    res.json(mockJoinInfo);
  });

  app.post(ROUTES.NODES_REGISTER, (_req, res) => {
    res.status(201).json({
      node: mockNodeInfo,
      hub_time_ms: Date.now(),
    });
  });

  app.get(ROUTES.NODES, (_req, res) => {
    res.json([mockNodeInfo]);
  });

  app.get('/api/v1/nodes/:id', (req, res) => {
    res.json({
      node: { ...mockNodeInfo, id: req.params.id },
      assessment: mockAssessment,
    });
  });

  app.get('/api/v1/nodes/:id/history', (_req, res) => {
    res.json({ points: [mockHistoryPoint] });
  });

  app.get('/api/v1/nodes/:id/evidence-bundle', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="evidence-${req.params.id}.json"`);
    res.json({
      node: mockNodeInfo,
      assessments: [mockAssessment],
      transitions: [],
      chain_head_hash: mockHeartbeatAck.ok ? mockSnapshot.assessments[0]?.cusum : 'e3b0c44',
      anchors: [mockAnchorInfo],
    });
  });

  app.post(ROUTES.HEARTBEATS, (_req, res) => {
    res.json(mockHeartbeatAck);
  });

  app.get(ROUTES.CONFIG, (_req, res) => {
    res.json(mockSnapshot.config);
  });

  app.patch(ROUTES.CONFIG, (req, res) => {
    res.json({ ...mockSnapshot.config, ...req.body });
  });

  app.get(ROUTES.ANCHORS, (_req, res) => {
    res.json([mockAnchorInfo]);
  });

  app.get(ROUTES.INCIDENTS, (_req, res) => {
    res.json([mockIncidentSummary]);
  });

  app.get('/api/v1/incidents/:id', (req, res) => {
    res.json({ ...mockIncident, id: req.params.id });
  });

  app.get('/api/v1/incidents/:id/export', (req, res) => {
    res.setHeader('Content-Disposition', `attachment; filename="incident-${req.params.id}.json"`);
    res.json(mockIncident);
  });

  app.get(ROUTES.OBSERVATIONS, (_req, res) => {
    res.json([mockObservation]);
  });

  app.post(ROUTES.OBSERVATIONS, (_req, res) => {
    res.status(201).json(mockObservation);
  });

  app.get('/api/v1/observations/:id/passport', (_req, res) => {
    res.json(mockPassport);
  });

  // Lab Mocks
  app.get(ROUTES.FAULTS, (_req, res) => {
    res.json([mockFault]);
  });

  app.post(ROUTES.FAULTS, (_req, res) => {
    res.status(201).json(mockFault);
  });

  app.delete('/api/v1/faults/:id', (_req, res) => {
    res.json({ ...mockFault, status: 'stopped' });
  });

  app.get(ROUTES.BASELINE, (_req, res) => {
    res.json(mockBaselineState);
  });

  app.post(ROUTES.SCIENCE_REPLAY, (_req, res) => {
    res.json(mockScienceReplayRes);
  });

  app.post(ROUTES.BENCHMARKS_RUN, (_req, res) => {
    res.status(202).json({ run_id: mockBenchmarkRun.id });
  });

  app.get(ROUTES.BENCHMARKS, (_req, res) => {
    res.json([mockBenchmarkRun]);
  });

  app.get('/api/v1/benchmarks/:id', (_req, res) => {
    res.json(mockBenchmarkRun);
  });

  app.get(ROUTES.METRICS_LIVE, (_req, res) => {
    res.json(mockLiveMetrics);
  });

  app.post(ROUTES.DEMO_SCENARIO, (_req, res) => {
    res.json({ ok: true, faults: [mockFault] });
  });

  app.post(ROUTES.DEMO_RESET, (_req, res) => {
    res.json({ ok: true });
  });

  // Socket.IO 1 Hz loop for mock assessments & dashboard subscription
  let intervalId: NodeJS.Timeout | null = null;
  const startInterval = () => {
    if (intervalId) return;
    intervalId = setInterval(() => {
      const now = Date.now();
      io.to('dashboard').emit(SOCKET_EVENTS.ASSESSMENTS, {
        t_ms: now,
        assessments: [
          {
            ...mockAssessment,
            t_ms: now,
          },
        ],
        network: mockSnapshot.network,
        baseline: mockBaselineState,
      });
    }, 1000);
  };

  io.on('connection', (socket) => {
    const auth = socket.handshake.auth || {};
    if (auth.role === 'dashboard') {
      socket.join('dashboard');
      socket.emit(SOCKET_EVENTS.SNAPSHOT, mockSnapshot);

      socket.on(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE, (_data: unknown, callback: (snapshot: typeof mockSnapshot) => void) => {
        if (typeof callback === 'function') {
          callback(mockSnapshot);
        }
      });

      startInterval();
    }
  });
}
