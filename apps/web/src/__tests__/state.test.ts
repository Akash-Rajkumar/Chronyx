import { describe, it, expect, beforeEach } from 'vitest';
import { useDashboardStore } from '../state/useDashboardStore.js';
import { mockSnapshot, mockAssessment, mockTransition, mockIncidentSummary, mockFault, mockNodeInfo, mockAnchorInfo } from '@chronyx/contracts';

describe('Zustand Dashboard Store (Phase 5)', () => {
  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  it('initializes with default disconnected state', () => {
    const state = useDashboardStore.getState();
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.nodes).toHaveLength(0);
    expect(state.isLoading).toBe(true);
  });

  it('ingests snapshot correctly', () => {
    useDashboardStore.getState().setSnapshot(mockSnapshot);

    const state = useDashboardStore.getState();
    expect(state.nodes).toHaveLength(mockSnapshot.nodes.length);
    expect(state.network).toEqual(mockSnapshot.network);
    expect(state.assessments[mockAssessment.node_id]).toBeDefined();
    expect(state.isLoading).toBe(false);
    expect(state.lastSeenMs).not.toBeNull();
  });

  it('updates anchors correctly', () => {
    useDashboardStore.getState().applyAnchors([mockAnchorInfo]);
    expect(useDashboardStore.getState().anchors).toHaveLength(1);
  });

  it('applies 1 Hz assessment updates granularly without resetting store', () => {
    useDashboardStore.getState().setSnapshot(mockSnapshot);

    const updatedAssessment = {
      ...mockAssessment,
      confidence: 0.85,
      z: 1.2,
    };

    useDashboardStore.getState().applyAssessments([updatedAssessment]);

    const state = useDashboardStore.getState();
    expect(state.assessments[mockAssessment.node_id]?.confidence).toBe(0.85);
    expect(state.assessments[mockAssessment.node_id]?.z).toBe(1.2);
  });

  it('applies transitions and prepends to history', () => {
    useDashboardStore.getState().applyTransition(mockTransition);

    const state = useDashboardStore.getState();
    expect(state.recentTransitions).toHaveLength(1);
    expect(state.recentTransitions[0]).toEqual(mockTransition);
  });

  it('manages incident lifecycle (open and update/close)', () => {
    useDashboardStore.getState().applyIncidentOpened(mockIncidentSummary);
    expect(useDashboardStore.getState().openIncidents).toHaveLength(1);

    const closedIncident = { ...mockIncidentSummary, status: 'closed' as const };
    useDashboardStore.getState().applyIncidentUpdated(closedIncident);
    expect(useDashboardStore.getState().openIncidents).toHaveLength(0);
  });

  it('updates faults and nodes correctly', () => {
    useDashboardStore.getState().applyNodeUpdated(mockNodeInfo);
    expect(useDashboardStore.getState().nodes).toHaveLength(1);

    useDashboardStore.getState().applyFaultChanged(mockFault);
    expect(useDashboardStore.getState().faults).toHaveLength(1);
  });

  it('preserves last known telemetry data when disconnected', () => {
    useDashboardStore.getState().setSnapshot(mockSnapshot);
    useDashboardStore.getState().setConnectionStatus('connected');
    expect(useDashboardStore.getState().nodes).toHaveLength(mockSnapshot.nodes.length);

    // Simulate disconnection
    useDashboardStore.getState().setConnectionStatus('disconnected');

    const state = useDashboardStore.getState();
    expect(state.connectionStatus).toBe('disconnected');
    expect(state.nodes).toHaveLength(mockSnapshot.nodes.length);
    expect(state.network).toEqual(mockSnapshot.network);
  });
});
