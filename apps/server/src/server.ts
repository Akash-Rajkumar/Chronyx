import http from 'http';
import express from 'express';
import cors from 'cors';
import { Server as SocketIOServer } from 'socket.io';
import { createEngine } from '@chronyx/engine';
import { createSim } from '@chronyx/sim';
import type { IEngine, ISim, UUID, Fault } from '@chronyx/contracts';
import { createCoreRoutes } from './core/routes.js';
import { setupGateway } from './core/gateway.js';
import { NodeRegistry } from './core/nodeRegistry.js';
import { HeartbeatService } from './core/heartbeatService.js';
import { Orchestrator } from './core/orchestrator.js';
import { registerLabRoutes } from './lab/index.js';
import { FaultRegistry } from './lab/faultRegistry.js';
import { LabFaultService } from './lab/faultService.js';
import { apiErrorMiddleware } from './middleware/error.js';
import { getRepositories } from './core/db/index.js';
import type { DatabaseRepositories } from './core/db/index.js';
import type { LabContext, IFaultService } from './ctx.js';
import { logger } from './logger.js';

export interface CreateServerOptions {
  nodeRegistry?: NodeRegistry;
  heartbeatService?: HeartbeatService;
  orchestrator?: Orchestrator;
  db?: DatabaseRepositories | null;
  engine?: IEngine;
  sim?: ISim | Promise<ISim>;
  faultService?: IFaultService;
  faultRegistry?: FaultRegistry | { expireAt(nowMs: number): void | Promise<void> };
  initVirtualNodes?: boolean;
}

export function createServer(options?: CreateServerOptions) {
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

  // Core Gateway services
  const nodeRegistry = options?.nodeRegistry ?? new NodeRegistry();
  const heartbeatService = options?.heartbeatService ?? new HeartbeatService(nodeRegistry);

  // Setup Lab Context seam
  const engine = options?.engine ?? createEngine();
  const db = options?.db !== undefined ? options.db : getRepositories();

  // Initial simulator reference: if provided synchronously, use it; otherwise null until init()
  let sim: ISim | null = options?.sim && !('then' in options.sim) ? (options.sim as ISim) : null;

  const emit = (event: string, payload: unknown) => io.to('dashboard').emit(event, payload);

  const sendToNode = (node_id: UUID, event: 'fault:apply' | 'fault:clear', payload: unknown) => {
    const node = nodeRegistry.getNodeSync(node_id);
    if (!node) {
      logger.warn({ node_id, event }, 'sendToNode: target node not found in registry');
      return;
    }
    if (!node.online) {
      logger.warn({ node_id, event }, 'sendToNode: target node is registered but offline');
      return;
    }
    io.to(`node:${node_id}`).emit(event, payload);
  };

  const faultRegistry: FaultRegistry =
    options?.faultRegistry instanceof FaultRegistry
      ? options.faultRegistry
      : options?.faultRegistry && 'dueAt' in options.faultRegistry && typeof options.faultRegistry.dueAt === 'function'
        ? (options.faultRegistry as FaultRegistry)
        : new FaultRegistry(emit);

  const simProxy = new Proxy({} as ISim, {
    get(_target, prop) {
      const targetSim = (sim ?? {}) as Record<string | symbol, unknown>;
      const value = targetSim[prop];
      if (typeof value === 'function') {
        return value.bind(targetSim);
      }
      return value;
    },
  });

  const faults: IFaultService =
    options?.faultService ??
    new LabFaultService({
      registry: faultRegistry,
      now: () => Date.now(),
      getNodes: () => nodeRegistry.getAllNodes(),
      sim: simProxy,
      sendToNode,
      emit,
      newId: () => crypto.randomUUID() as UUID,
    });

  // Instantiate Orchestrator (P1-T4)
  const orchestrator =
    options?.orchestrator ??
    new Orchestrator({
      nodeRegistry,
      engine,
      db,
      io,
      sim,
      faultRegistry: options?.faultRegistry ?? faultRegistry,
      faultService: options?.faultService
        ? 'runLifecycle' in options.faultService && typeof options.faultService.runLifecycle === 'function'
          ? (options.faultService as { runLifecycle(nowMs: number): Fault[] | void | Promise<Fault[] | void> })
          : null
        : options?.faultRegistry && !('dueAt' in options.faultRegistry)
          ? null
          : 'runLifecycle' in faults && typeof (faults as { runLifecycle?: unknown }).runLifecycle === 'function'
            ? (faults as { runLifecycle(nowMs: number): Fault[] | void | Promise<Fault[] | void> })
            : null,
    });

  // Mount Socket.IO Node Gateway (Part E2c)
  setupGateway(io, nodeRegistry, heartbeatService, orchestrator, engine, db);

  // Mount Core Routes
  app.use(createCoreRoutes(nodeRegistry, heartbeatService, orchestrator, engine, db));

  const labContext: LabContext = {
    now: () => Date.now(),
    hubNow: () => performance.timeOrigin + performance.now(),
    engine,
    sim: sim as ISim,
    faults,
    db,
    emit,
    sendToNode,
    getAssessments: () => Array.from(orchestrator.getState().latestAssessments.values()),
    getNodes: () => nodeRegistry.getAllNodes(),
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

  // Asynchronous initialization boundary (D-001 Phase B)
  let isInitialized = false;
  let initPromise: Promise<void> | null = null;

  async function init(): Promise<void> {
    if (isInitialized) {
      return;
    }
    if (initPromise) {
      return initPromise;
    }

    initPromise = (async () => {
      // 1. Resolve simulator instance (supports both sync and async createSim / options.sim)
      let resolvedSim: ISim | null = null;
      if (options?.sim !== undefined) {
        resolvedSim = await Promise.resolve(options.sim);
      } else {
        const simResult = createSim();
        resolvedSim = await Promise.resolve(simResult as unknown as ISim);
      }

      sim = resolvedSim;
      orchestrator.setSimulator(resolvedSim);
      (labContext as { sim: ISim | null }).sim = resolvedSim;
      if (faults && 'deps' in faults && (faults as { deps?: { sim?: ISim | null } }).deps) {
        (faults as { deps: { sim: ISim | null } }).deps.sim = resolvedSim;
      }

      // 2. Resolve virtual node count
      let virtualNodeCount = 3;
      if (options?.initVirtualNodes !== undefined) {
        virtualNodeCount = options.initVirtualNodes ? 3 : 0;
      } else if (process.env.VIRTUAL_NODES !== undefined) {
        const parsed = parseInt(process.env.VIRTUAL_NODES, 10);
        virtualNodeCount = Number.isInteger(parsed) && parsed >= 0 ? parsed : 3;
      }

      // 3. Register virtual nodes asynchronously if requested
      if (virtualNodeCount > 0 && resolvedSim && typeof resolvedSim.addVirtualNode === 'function') {
        const existingNodes = nodeRegistry.getAllNodes();
        const existingVirtualCount = existingNodes.filter((n) => n.kind === 'virtual').length;
        const vNames = ['V-Alpha', 'V-Beta', 'V-Gamma', 'V-Delta', 'V-Epsilon'];

        for (let i = existingVirtualCount; i < virtualNodeCount; i++) {
          const vNode = await Promise.resolve(resolvedSim.addVirtualNode(vNames[i] || `V-Node-${i + 1}`));
          if (!nodeRegistry.getNodeSync(vNode.id)) {
            nodeRegistry.registerNodeDirect(vNode);
            if (db && typeof db.nodes?.create === 'function') {
              try {
                await db.nodes.create({
                  id: vNode.id,
                  name: vNode.name,
                  kind: vNode.kind,
                  public_key: vNode.public_key,
                });
              } catch (err) {
                logger.warn({ err, nodeId: vNode.id }, 'Could not persist virtual node to database (may already exist)');
              }
            }
          }
        }
      }

      isInitialized = true;
    })().catch((err) => {
      initPromise = null;
      throw err;
    });

    return initPromise;
  }

  return {
    app,
    server,
    io,
    nodeRegistry,
    heartbeatService,
    orchestrator,
    labContext,
    faultRegistry,
    faultService: faults,
    sendToNode: labContext.sendToNode,
    init,
  };
}
