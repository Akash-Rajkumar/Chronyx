/**
 * Socket.IO client for the Chronyx Dashboard (Part E2c)
 * Connects with { auth: { role: 'dashboard' } } and binds realtime streams
 * to the Zustand central store.
 */
import { io, Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@chronyx/contracts';
import type {
  Snapshot,
  Assessment,
  Transition,
  IncidentSummary,
  Fault,
  NodeInfo,
  AnchorInfo,
} from '@chronyx/contracts';
import { useDashboardStore } from '../state/useDashboardStore.js';
import { isMockMode, getMockSnapshot } from '../mocks/mockDashboardData.js';

let socket: Socket | null = null;

export function getDashboardSocket(): Socket | null {
  return socket;
}

export function initDashboardSocket(): () => void {
  const store = useDashboardStore.getState();

  if (isMockMode()) {
    store.setSnapshot(getMockSnapshot());
    store.setConnectionStatus('connected');
    return () => {};
  }

  const wsUrl =
    (typeof import.meta !== 'undefined' && import.meta.env?.['VITE_WS_URL']) ||
    (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3001');

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
    socket?.emit(SOCKET_EVENTS.DASHBOARD_SUBSCRIBE);
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

  socket.on(SOCKET_EVENTS.ASSESSMENTS, (assessments: Assessment[]) => {
    useDashboardStore.getState().applyAssessments(assessments);
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
    if (socket) {
      socket.disconnect();
      socket = null;
    }
  };
}
