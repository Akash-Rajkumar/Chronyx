// MOCK-DATA (remove before main)
/**
 * Mock data fixtures for isolated UI development and testing.
 * Re-exports frozen fixtures from @chronyx/contracts.
 * Switched on ONLY by VITE_USE_MOCKS=1 (Part D4).
 */
import {
  mockSnapshot,
  mockNodeInfo,
  mockAssessment,
  mockNetworkHealth,
  mockAnchorInfo,
  mockIncident,
  mockIncidentSummary,
  mockHistoryPoint,
  mockJoinInfo,
  mockLiveMetrics,
  mockBenchmarkRun,
  mockScienceReplayRes,
  mockBaselineState,
  mockFault,
  mockHeartbeat,
  mockHeartbeatAck,
  mockTransition,
  mockObservation,
  mockPassport,
} from '@chronyx/contracts';
import type { Snapshot } from '@chronyx/contracts';
import { useDashboardStore } from '../state/useDashboardStore.js';

export const isMockMode = (): boolean => {
  if (typeof import.meta === 'undefined' || !import.meta.env) return false;
  return import.meta.env['VITE_USE_MOCKS'] === '1';
};

export const getMockSnapshot = (): Snapshot => {
  return JSON.parse(JSON.stringify(mockSnapshot)) as Snapshot;
};

export const initMockDashboard = (): boolean => {
  if (!isMockMode()) return false;
  const store = useDashboardStore.getState();
  store.setSnapshot(getMockSnapshot());
  store.setConnectionStatus('mock');
  return true;
};

export {
  mockSnapshot,
  mockNodeInfo,
  mockAssessment,
  mockNetworkHealth,
  mockAnchorInfo,
  mockIncident,
  mockIncidentSummary,
  mockHistoryPoint,
  mockJoinInfo,
  mockLiveMetrics,
  mockBenchmarkRun,
  mockScienceReplayRes,
  mockBaselineState,
  mockFault,
  mockHeartbeat,
  mockHeartbeatAck,
  mockTransition,
  mockObservation,
  mockPassport,
};
