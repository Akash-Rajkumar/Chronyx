// TEST-FIXTURE
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { OverviewPage } from '../pages/overview/OverviewPage.js';
import { useDashboardStore } from '../state/useDashboardStore.js';
import type { NodeInfo, Assessment, NetworkHealth } from '@chronyx/contracts';

describe('Overview Data Integrity (C2)', () => {
  const testNode: NodeInfo = {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'T-Observatory',
    kind: 'virtual',
    public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000000=',
    created_at: '2026-11-20T12:00:00.000Z',
    last_seen_at: '2026-11-20T12:00:01.000Z',
    online: true,
  };

  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  it('never defaults a missing assessment to trusted', () => {
    // Populate node with NO assessment
    useDashboardStore.setState({
      nodes: [testNode],
      assessments: {},
      isLoading: false,
    });

    const element = React.createElement(
      MemoryRouter,
      null,
      React.createElement(OverviewPage, null),
    );
    const html = renderToString(element);

    // Must display "Unassessed" badge and NOT "Trusted"
    expect(html).toContain('Unassessed');
    expect(html).not.toContain('●</span><span>Trusted');
  });

  it('never defaults missing confidence to 1 or 100%, and does not use 0%', () => {
    // Populate node with assessment missing confidence
    const partialAssessment: Assessment = {
      node_id: testNode.id,
      t_ms: 1700000000000,
      state: 'suspect',
      error_est_ms: 3.5,
      sigma_ms: 0.5,
      z: 3.8,
      cusum: 2.1,
      confidence: undefined as unknown as number, // Missing confidence
      streams: [],
      reasons: ['PEER_OUTLIER'],
      suspected_cause: 'local_clock',
      quarantined_since_ms: null,
    };

    useDashboardStore.setState({
      nodes: [testNode],
      assessments: { [testNode.id]: partialAssessment },
      isLoading: false,
    });

    const element = React.createElement(
      MemoryRouter,
      null,
      React.createElement(OverviewPage, null),
    );
    const html = renderToString(element);

    // Must display neutral "--" and NOT "100%" or "0%"
    expect(html).toContain('>--</span>');
    expect(html).not.toContain('100%');
    expect(html).not.toContain('0%');
  });

  it('shows anomaly alert when quarantined/suspect nodes exist even with zero recent transitions', () => {
    const anomalousNetwork: NetworkHealth = {
      score: 65,
      n: 4,
      trusted: 2,
      suspect: 1,
      quarantined: 1,
      recovering: 0,
      fault_tolerance_f: 1,
      anchor_ok: true,
    };

    useDashboardStore.setState({
      nodes: [testNode],
      network: anomalousNetwork,
      recentTransitions: [], // Empty transitions buffer!
      isLoading: false,
    });

    const element = React.createElement(
      MemoryRouter,
      null,
      React.createElement(OverviewPage, null),
    );
    const html = renderToString(element);

    // Must NOT claim all nodes operational
    expect(html).not.toContain('All nodes operational');
    // Must honestly report cluster anomaly
    expect(html).toContain('Cluster Anomaly Active');
    expect(html).toContain('quarantined');
    expect(html).toContain('suspect');
  });

  it('shows neutral message when network data is empty or unavailable', () => {
    useDashboardStore.setState({
      nodes: [],
      network: null,
      recentTransitions: [],
      isLoading: false,
    });

    const element = React.createElement(
      MemoryRouter,
      null,
      React.createElement(OverviewPage, null),
    );
    const html = renderToString(element);

    expect(html).toContain('Observatory cluster standby. Telemetry status unavailable.');
    expect(html).not.toContain('All nodes operational');
  });

  it('shows operational calm ONLY when all nodes are verified trusted', () => {
    const perfectNetwork: NetworkHealth = {
      score: 100,
      n: 4,
      trusted: 4,
      suspect: 0,
      quarantined: 0,
      recovering: 0,
      fault_tolerance_f: 1,
      anchor_ok: true,
    };

    useDashboardStore.setState({
      nodes: [testNode],
      network: perfectNetwork,
      recentTransitions: [],
      isLoading: false,
    });

    const element = React.createElement(
      MemoryRouter,
      null,
      React.createElement(OverviewPage, null),
    );
    const html = renderToString(element);

    expect(html).toContain('Cluster Operational');
    expect(html).toContain('nodes trusted and calibrated');
  });
});
