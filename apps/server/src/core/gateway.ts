import type { Server as SocketIOServer, Socket } from 'socket.io';
import { DEFAULT_ENGINE_CONFIG, SOCKET_EVENTS } from '@chronyx/contracts';
import type { Heartbeat, IEngine } from '@chronyx/contracts';
import { NodeRegistry } from './nodeRegistry.js';
import { HeartbeatService } from './heartbeatService.js';
import type { Orchestrator } from './orchestrator.js';
import type { DatabaseRepositories } from './db/index.js';
import { buildSnapshot } from './snapshot.js';
import { logger } from '../logger.js';

export function setupGateway(
  io: SocketIOServer,
  nodeRegistry: NodeRegistry,
  heartbeatService: HeartbeatService,
  orchestrator?: Orchestrator,
  engine?: IEngine,
  db?: DatabaseRepositories | null,
): void {
  // Socket.IO authentication middleware (Part E2c)
  io.use(async (socket: Socket, next) => {
    try {
      const auth = socket.handshake.auth as { node_id?: string; role?: string } | undefined;

      if (auth?.role === 'dashboard') {
        socket.data.role = 'dashboard';
        return next();
      }

      if (auth?.node_id) {
        const node = await nodeRegistry.getNode(auth.node_id);
        if (!node) {
          return next(new Error('UNKNOWN_NODE'));
        }
        socket.data.node_id = node.id;
        return next();
      }

      // Allow general unauthenticated connection (e.g. for registration or handshake)
      return next();
    } catch (err) {
      logger.error({ err }, 'Error in Socket.IO auth middleware');
      return next(new Error('INTERNAL_ERROR'));
    }
  });

  io.on('connection', (socket: Socket) => {
    // If dashboard, join dashboard room
    if (socket.data.role === 'dashboard') {
      socket.join('dashboard');
    }

    // Mark node connected if node_id was set during auth handshake
    if (socket.data.node_id) {
      socket.join(`node:${socket.data.node_id}`);
      nodeRegistry.markNodeConnected(socket.data.node_id, socket.id);
    }

    // 1. NODE_JOIN event (Part E1c, E2c)
    // Client emits 'node:join', ack returns { next_seq, prev_hash, hub_time_ms, config }
    socket.on(
      SOCKET_EVENTS.NODE_JOIN,
      async (data: { node_id?: string } | undefined, ack?: (response: unknown) => void) => {
        try {
          if (socket.data.role === 'dashboard') {
            if (typeof ack === 'function') {
              ack({ ok: false, error: 'UNAUTHORIZED' });
            }
            return;
          }

          const nodeId = socket.data.node_id || data?.node_id;
          if (!nodeId) {
            if (typeof ack === 'function') {
              ack({ ok: false, error: 'UNKNOWN_NODE' });
            }
            return;
          }

          const node = await nodeRegistry.getNode(nodeId);
          if (!node) {
            if (typeof ack === 'function') {
              ack({ ok: false, error: 'UNKNOWN_NODE' });
            }
            return;
          }

          socket.data.node_id = node.id;
          socket.join(`node:${node.id}`);
          nodeRegistry.markNodeConnected(node.id, socket.id);

          const connectedNode = nodeRegistry.getNodeSync(node.id) ?? node;
          io.to('dashboard').emit(SOCKET_EVENTS.NODE_UPDATED, { ...connectedNode });

          const response = {
            next_seq: nodeRegistry.getExpectedSeq(node.id),
            prev_hash: nodeRegistry.getLastVerifiedHash(node.id),
            hub_time_ms: Date.now(),
            config: engine?.getConfig() ?? DEFAULT_ENGINE_CONFIG,
          };

          if (typeof ack === 'function') {
            ack(response);
          }
        } catch (err) {
          logger.error({ err }, 'Error handling node:join');
          if (typeof ack === 'function') {
            ack({ ok: false, error: 'INTERNAL_ERROR' });
          }
        }
      },
    );

    // 2. TIME_PING event (Part E1c, E2c)
    // Client emits 'time:ping', ack returns { t2, t3 } in high-res hub time (0.1 ms or better)
    socket.on(SOCKET_EVENTS.TIME_PING, (_data: unknown, ack?: (response: unknown) => void) => {
      const t2 = performance.timeOrigin + performance.now();
      const t3 = performance.timeOrigin + performance.now();

      if (typeof ack === 'function') {
        ack({ t2, t3 });
      }
    });

    // 3. HEARTBEAT event (Part E1c, E2c)
    // Client emits 'heartbeat' Heartbeat, ack returns HeartbeatAck
    socket.on(
      SOCKET_EVENTS.HEARTBEAT,
      async (heartbeat: Heartbeat, ack?: (response: unknown) => void) => {
        try {
          if (socket.data.role === 'dashboard') {
            if (typeof ack === 'function') {
              ack({ ok: false, code: 'BAD_REQUEST' });
            }
            return;
          }

          const serverRxMs = Date.now();
          const result = await heartbeatService.verifyAndIngest(heartbeat, serverRxMs);

          if (typeof ack === 'function') {
            ack(result);
          }
        } catch (err) {
          logger.error({ err }, 'Error handling heartbeat');
          if (typeof ack === 'function') {
            ack({ ok: false, code: 'BAD_REQUEST' });
          }
        }
      },
    );

    // 4. DASHBOARD_SUBSCRIBE event (Part E2c)
    // Dashboard emits 'dashboard:subscribe', ack returns Snapshot, server emits 'snapshot'
    socket.on(
      SOCKET_EVENTS.DASHBOARD_SUBSCRIBE,
      async (_data: unknown, ack?: (response: unknown) => void) => {
        try {
          socket.join('dashboard');
          const snapshot = await buildSnapshot(nodeRegistry, orchestrator, engine, db);

          if (typeof ack === 'function') {
            ack(snapshot);
          }
          socket.emit(SOCKET_EVENTS.SNAPSHOT, snapshot);
        } catch (err) {
          logger.error({ err }, 'Error handling dashboard:subscribe');
        }
      },
    );

    // Disconnect cleanup
    socket.on('disconnect', () => {
      const disconnected = nodeRegistry.markNodeDisconnected(socket.id);
      for (const node of disconnected) {
        io.to('dashboard').emit(SOCKET_EVENTS.NODE_UPDATED, node);
      }
    });
  });
}
