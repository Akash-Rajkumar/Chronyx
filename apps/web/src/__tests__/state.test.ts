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

  it('supports mock connection status honestly', () => {
    useDashboardStore.getState().setConnectionStatus('mock');
    expect(useDashboardStore.getState().connectionStatus).toBe('mock');
  });

  describe('Defensive Assessments Payload Hardening (P3)', () => {
    const updatedAssessment = {
      ...mockAssessment,
      confidence: 0.92,
      z: 0.8,
    };

    const newNetwork = {
      ...mockSnapshot.network,
      score: 95,
      trusted: 5,
    };

    const newBaseline = {
      source: 'model' as const,
      label: 'Updated Baseline Model',
      per_node: [
        {
          node_id: mockAssessment.node_id,
          followed_error_ms: 0.12,
          alarm: false as const,
        },
      ],
      cluster_time_error_ms: 0.05,
    };

    it('handles array-shaped assessments payload and preserves network/baseline', () => {
      useDashboardStore.getState().setSnapshot(mockSnapshot);
      const initialNetwork = useDashboardStore.getState().network;
      const initialBaseline = useDashboardStore.getState().baseline;

      useDashboardStore.getState().applyAssessments([updatedAssessment]);

      const state = useDashboardStore.getState();
      expect(state.assessments[mockAssessment.node_id]?.confidence).toBe(0.92);
      expect(state.assessments[mockAssessment.node_id]?.z).toBe(0.8);
      // Network and baseline preserved
      expect(state.network).toEqual(initialNetwork);
      expect(state.baseline).toEqual(initialBaseline);
    });

    it('handles object-shaped payload updating assessments, network health, and baseline', () => {
      useDashboardStore.getState().setSnapshot(mockSnapshot);

      useDashboardStore.getState().applyAssessments({
        t_ms: 1700000000500,
        assessments: [updatedAssessment],
        network: newNetwork,
        baseline: newBaseline,
      });

      const state = useDashboardStore.getState();
      expect(state.assessments[mockAssessment.node_id]?.confidence).toBe(0.92);
      expect(state.network?.score).toBe(95);
      expect(state.baseline?.label).toBe('Updated Baseline Model');
      expect(state.serverTimeMs).toBe(1700000000500);
    });

    it('handles missing optional fields in object-shaped payload without clearing existing state', () => {
      useDashboardStore.getState().setSnapshot(mockSnapshot);
      const initialNetwork = useDashboardStore.getState().network;
      const initialBaseline = useDashboardStore.getState().baseline;

      // Payload with only assessments (no network, no baseline)
      useDashboardStore.getState().applyAssessments({
        assessments: [updatedAssessment],
      });

      let state = useDashboardStore.getState();
      expect(state.assessments[mockAssessment.node_id]?.confidence).toBe(0.92);
      expect(state.network).toEqual(initialNetwork);
      expect(state.baseline).toEqual(initialBaseline);

      // Payload with only network (no assessments, no baseline)
      useDashboardStore.getState().applyAssessments({
        network: newNetwork,
      });

      state = useDashboardStore.getState();
      expect(state.network?.score).toBe(95);
      expect(state.assessments[mockAssessment.node_id]?.confidence).toBe(0.92);
      expect(state.baseline).toEqual(initialBaseline);
    });

    it('handles malformed payloads safely without crashing or corrupting valid state', () => {
      useDashboardStore.getState().setSnapshot(mockSnapshot);
      const snapshotAssessments = { ...useDashboardStore.getState().assessments };
      const snapshotNetwork = useDashboardStore.getState().network;
      const snapshotBaseline = useDashboardStore.getState().baseline;

      // None of these should throw or mutate state
      useDashboardStore.getState().applyAssessments(null);
      useDashboardStore.getState().applyAssessments(undefined);
      useDashboardStore.getState().applyAssessments('invalid-string');
      useDashboardStore.getState().applyAssessments(12345);
      useDashboardStore.getState().applyAssessments({});
      useDashboardStore.getState().applyAssessments({ unknown_field: 999 });

      const state = useDashboardStore.getState();
      expect(state.assessments).toEqual(snapshotAssessments);
      expect(state.network).toEqual(snapshotNetwork);
      expect(state.baseline).toEqual(snapshotBaseline);
    });

    it('filters out invalid elements from an array payload while applying valid ones', () => {
      useDashboardStore.getState().setSnapshot(mockSnapshot);

      const mixedPayload = [
        updatedAssessment,
        { invalid_node: true, missing_everything: 123 },
      ];

      useDashboardStore.getState().applyAssessments(mixedPayload);

      const state = useDashboardStore.getState();
      expect(state.assessments[mockAssessment.node_id]?.confidence).toBe(0.92);
    });

    it('preserves existing state when all elements in assessments payload are invalid', () => {
      useDashboardStore.getState().setSnapshot(mockSnapshot);
      const initialAssessments = { ...useDashboardStore.getState().assessments };

      useDashboardStore.getState().applyAssessments([
        { bad_node: 1 },
        { bad_node: 2 },
      ]);

      const state = useDashboardStore.getState();
      expect(state.assessments).toEqual(initialAssessments);
    });

    it('sanitizes assessments with omitted nullable/optional fields to contract-compliant format', () => {
      useDashboardStore.getState().setSnapshot(mockSnapshot);

      // Server emits assessment without quarantined_since_ms or streams
      const looseAssessment = {
        node_id: mockAssessment.node_id,
        t_ms: 1700000001000,
        state: 'trusted',
        error_est_ms: 0.08,
        confidence: 0.98,
      };

      useDashboardStore.getState().applyAssessments({
        t_ms: 1700000001000,
        assessments: [looseAssessment],
      });

      const state = useDashboardStore.getState();
      const stored = state.assessments[mockAssessment.node_id];
      expect(stored).toBeDefined();
      expect(stored?.error_est_ms).toBe(0.08);
      expect(stored?.quarantined_since_ms).toBeNull();
      expect(Array.isArray(stored?.streams)).toBe(true);
      expect(stored?.confidence).toBe(0.98);
    });

    it('defensively extracts partial network health and baseline state without throwing', () => {
      useDashboardStore.getState().setSnapshot(mockSnapshot);

      const partialNetwork = {
        score: 88,
        n: 6,
        trusted: 5,
        suspect: 1,
        anchor_ok: true,
      };

      const partialBaseline = {
        source: 'chrony',
        label: 'Chrony NTP Reference',
        per_node: [],
        cluster_time_error_ms: 0.02,
      };

      useDashboardStore.getState().applyAssessments({
        t_ms: 1700000002000,
        assessments: [updatedAssessment],
        network: partialNetwork,
        baseline: partialBaseline,
      });

      const state = useDashboardStore.getState();
      expect(state.network?.score).toBe(88);
      expect(state.network?.anchor_ok).toBe(true);
      expect(state.baseline?.source).toBe('chrony');
      expect(state.baseline?.label).toBe('Chrony NTP Reference');
      expect(state.isLoading).toBe(false);
    });
  });
});
