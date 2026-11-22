/**
 * Socket.IO client for the Chronyx Dashboard (Part E2c)
 * Connects with { auth: { role: 'dashboard' } } and binds realtime streams
 * to the Zustand central store.
 * Prevents duplicate connections and honestly represents mock vs live states.
 * Resilient to mock purge by importing contract fixtures directly.
 */
import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS, mockSnapshot } from '@chronyx/contracts';
import type {
  Snapshot,
  Transition,
  IncidentSummary,
  Fault,
  NodeInfo,
  AnchorInfo,
} from '@chronyx/contracts';
import {
  useDashboardStore,
  type ServerAssessmentsPayload,
  type AssessmentsEventPayload,
} from '../state/useDashboardStore.js';
import { api } from './client.js';

export type { ServerAssessmentsPayload, AssessmentsEventPayload };

let socket: Socket | null = null;
let subscribersCount = 0;

export const isMockMode = (): boolean => {
  if (typeof import.meta === 'undefined' || !import.meta.env) return false;
  return import.meta.env['VITE_USE_MOCKS'] === '1';
};

export function getDashboardSocket(): Socket | null {
  return socket;
}

export function getWsUrl(): string {
  if (typeof import.meta !== 'undefined' && import.meta.env?.['VITE_WS_URL']) {
    return import.meta.env['VITE_WS_URL'];
  }
  if (typeof window !== 'undefined') {
    // When served from Vite dev server on port 5173 / 4173, gateway is on 3001
    if (window.location.port === '5173' || window.location.port === '4173') {
      return `${window.location.protocol}//${window.location.hostname}:3001`;
    }
    return window.location.origin;
  }
  return 'http://localhost:3001';
}

export function initDashboardSocket(): () => void {
  subscribersCount++;
  const store = useDashboardStore.getState();

  // Mock mode: honest representation, only activates when VITE_USE_MOCKS=1
  if (isMockMode()) {
    store.setSnapshot(JSON.parse(JSON.stringify(mockSnapshot)));
    store.setConnectionStatus('mock');
    return () => {
      subscribersCount = Math.max(0, subscribersCount - 1);
    };
  }

  // Attempt initial REST snapshot hydration (single non-polling bootstrap) if available
  if (typeof window !== 'undefined') {
    void api
      .getState()
      .then((snapshot) => {
        if (snapshot && typeof snapshot === 'object') {
          useDashboardStore.getState().setSnapshot(snapshot);
        }
      })
      .catch(() => {
        // Fall back gracefully: socket snapshot event and dashboard:subscribe will hydrate
      });
  }

  // Live mode: reuse existing socket if already connected or connecting
  if (socket) {
    return () => {
      subscribersCount = Math.max(0, subscribersCount - 1);
      if (subscribersCount === 0 && socket) {
        socket.disconnect();
        socket = null;
      }
    };
  }

  const wsUrl = getWsUrl();

  store.setConnectionStatus('connecting');

  socket = io(wsUrl, {
    auth: { role: 'dashboard' },
    transports: ['websocket', 'polling'],
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
  });

  socket.on('connect', () => {
    useDashboardStore.getState().setConnectionStatus('connected');
    // Part E2c: Emit dashboard:subscribe with ack callback for immediate snapshot delivery
    socket?.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE, {}, (ackSnapshot: unknown) => {
      if (ackSnapshot && typeof ackSnapshot === 'object') {
        useDashboardStore.getState().setSnapshot(ackSnapshot as Snapshot);
      }
    });
  });

  socket.on('disconnect', () => {
    // Keep last known good data across disconnect
    useDashboardStore.getState().setConnectionStatus('disconnected');
  });

  socket.on('connect_error', (err) => {
    useDashboardStore.getState().setConnectionStatus('error');
    useDashboardStore.getState().setError(err.message);
  });

  socket.on(SOCKET_EVENTS.SNAPSHOT, (snapshot: Snapshot) => {
    useDashboardStore.getState().setSnapshot(snapshot);
  });

  // Part E2c: The server emits { t_ms, assessments, network, baseline } on 1 Hz ticker.
  // We accept unknown from the Socket.IO transport and normalize defensively at the store boundary.
  socket.on(SOCKET_EVENTS.ASSESSMENTS, (payload: unknown) => {
    useDashboardStore.getState().applyAssessments(payload);
  });

  socket.on(SOCKET_EVENTS.TRANSITION, (transition: Transition) => {
    useDashboardStore.getState().applyTransition(transition);
  });

  socket.on(SOCKET_EVENTS.INCIDENT_OPENED, (incident: IncidentSummary) => {
    useDashboardStore.getState().applyIncidentOpened(incident);
  });

  socket.on(SOCKET_EVENTS.INCIDENT_UPDATED, (incident: IncidentSummary) => {
    useDashboardStore.getState().applyIncidentUpdated(incident);
  });

  socket.on(SOCKET_EVENTS.FAULT_CHANGED, (fault: Fault) => {
    useDashboardStore.getState().applyFaultChanged(fault);
  });

  socket.on(SOCKET_EVENTS.NODE_UPDATED, (node: NodeInfo) => {
    useDashboardStore.getState().applyNodeUpdated(node);
  });

  socket.on(SOCKET_EVENTS.ANCHORS, (anchors: AnchorInfo[]) => {
    useDashboardStore.getState().applyAnchors(anchors);
  });

  return () => {
    subscribersCount = Math.max(0, subscribersCount - 1);
    if (subscribersCount === 0 && socket) {
      socket.disconnect();
      socket = null;
    }
  };
}
