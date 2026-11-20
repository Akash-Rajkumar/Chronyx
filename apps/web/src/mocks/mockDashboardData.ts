// MOCK-DATA (remove before main)
/**
 * Mock data fixtures for isolated UI development and testing.
 * Re-exports frozen fixtures from @chronyx/contracts.
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

export const isMockMode = (): boolean => {
  return typeof import.meta !== 'undefined' && import.meta.env?.['VITE_USE_MOCKS'] === 'true';
};

export const getMockSnapshot = (): Snapshot => {
  return JSON.parse(JSON.stringify(mockSnapshot)) as Snapshot;
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
