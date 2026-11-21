// TEST-FIXTURE
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  OverviewPage,
  formatSignedOffset,
} from '../pages/overview/OverviewPage.js';
import { useDashboardStore } from '../state/useDashboardStore.js';
import type { NodeInfo, Assessment, NetworkHealth, Transition } from '@chronyx/contracts';
import { mockSnapshot } from '@chronyx/contracts';

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

    expect(html).toContain('Unassessed');
    expect(html).not.toContain('●</span><span>Trusted');
  });

  it('never defaults missing confidence to 1 or 100%, and does not use 0%', () => {
    const partialAssessment: Assessment = {
      node_id: testNode.id,
      t_ms: 1700000000000,
      state: 'suspect',
      error_est_ms: 3.5,
      sigma_ms: 0.5,
      z: 3.8,
      cusum: 2.1,
      confidence: undefined as unknown as number,
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

    expect(html).toContain('>--</span>');
    expect(html).not.toContain('100%');
    expect(html).not.toContain('0%');
  });
});

describe('Live Overview Requirements (P3-T3)', () => {
  const nodeA: NodeInfo = {
    id: 'aaaa-1111-1111-1111',
    name: 'Alpha-Observatory',
    kind: 'virtual',
    public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000001=',
    created_at: '2026-11-20T12:00:00.000Z',
    last_seen_at: '2026-11-20T12:00:01.000Z',
    online: true,
  };

  const nodeB: NodeInfo = {
    id: 'bbbb-2222-2222-2222',
    name: 'Beta-Browser',
    kind: 'browser',
    public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000002=',
    created_at: '2026-11-20T12:00:00.000Z',
    last_seen_at: '2026-11-20T12:00:02.000Z',
    online: true,
  };

  const nodeZ: NodeInfo = {
    id: 'zzzz-9999-9999-9999',
    name: 'Zeta-Station',
    kind: 'virtual',
    public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000009=',
    created_at: '2026-11-20T12:00:00.000Z',
    last_seen_at: '2026-11-20T12:00:03.000Z',
    online: false,
  };

  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  it('1. Network summary renders correct server-provided values', () => {
    const network: NetworkHealth = {
      score: 96,
      n: 4,
      trusted: 3,
      suspect: 1,
      quarantined: 0,
      recovering: 0,
      fault_tolerance_f: 1,
      anchor_ok: true,
    };

    useDashboardStore.setState({
      network,
      connectionStatus: 'connected',
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    expect(html).toContain('data-testid="network-summary"');
    expect(html).toContain('96%');
    expect(html).toContain('Tolerates 1 faulty of 4 nodes');
    expect(html).toContain('Anchors OK');
    expect(html).toContain('Connected');
  });

  it('2. Node cards render real and virtual labels correctly', () => {
    useDashboardStore.setState({
      nodes: [nodeA, nodeB],
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    expect(html).toContain('Virtual');
    expect(html).toContain('Real');
    expect(html).toContain('data-testid="node-kind-badge"');
  });

  it('3. Signed error values preserve positive and negative signs', () => {
    expect(formatSignedOffset(3.45)).toBe('+3.45 ms');
    expect(formatSignedOffset(-2.18)).toBe('-2.18 ms');
    expect(formatSignedOffset(0)).toBe('+0.00 ms');
    expect(formatSignedOffset(null)).toBe('--');

    const assessmentPos: Assessment = {
      node_id: nodeA.id,
      t_ms: Date.now(),
      state: 'trusted',
      error_est_ms: 1.42,
      sigma_ms: 0.25,
      z: 0.85,
      cusum: 0.42,
      confidence: 0.98,
      streams: [],
      reasons: ['RECOVERY_BAND_OK'],
      suspected_cause: 'none',
      quarantined_since_ms: null,
    };

    const assessmentNeg: Assessment = {
      node_id: nodeB.id,
      t_ms: Date.now(),
      state: 'suspect',
      error_est_ms: -3.85,
      sigma_ms: 0.65,
      z: 2.95,
      cusum: 1.85,
      confidence: 0.82,
      streams: [],
      reasons: ['PEER_OUTLIER'],
      suspected_cause: 'local_clock',
      quarantined_since_ms: null,
    };

    useDashboardStore.setState({
      nodes: [nodeA, nodeB],
      assessments: {
        [nodeA.id]: assessmentPos,
        [nodeB.id]: assessmentNeg,
      },
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    expect(html).toContain('+1.42 ms');
    expect(html).toContain('-3.85 ms');
  });

  it('4. Node card navigation uses the correct node ID', () => {
    useDashboardStore.setState({
      nodes: [nodeA],
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    expect(html).toContain(`href="/nodes/${nodeA.id}"`);
  });

  it('5. Nodes are sorted alphabetically by name', () => {
    // Provide nodes in reverse order: Zeta, Beta, Alpha
    useDashboardStore.setState({
      nodes: [nodeZ, nodeB, nodeA],
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    const posAlpha = html.indexOf('Alpha-Observatory');
    const posBeta = html.indexOf('Beta-Browser');
    const posZeta = html.indexOf('Zeta-Station');

    expect(posAlpha).toBeGreaterThan(-1);
    expect(posBeta).toBeGreaterThan(posAlpha);
    expect(posZeta).toBeGreaterThan(posBeta);
  });

  it('6. Recent transitions display no more than five entries in newest-first order', () => {
    const transitions: Transition[] = [
      { node_id: nodeA.id, from: 'trusted', to: 'suspect', at_ms: 1700000000005, reasons: ['OSC_STEP'], error_est_ms: 12.5 },
      { node_id: nodeB.id, from: 'suspect', to: 'quarantined', at_ms: 1700000000004, reasons: ['CUSUM_DRIFT'], error_est_ms: 25.0 },
      { node_id: nodeA.id, from: 'suspect', to: 'trusted', at_ms: 1700000000003, reasons: ['RECOVERY_BAND_OK'], error_est_ms: 0.5 },
      { node_id: nodeZ.id, from: 'trusted', to: 'suspect', at_ms: 1700000000002, reasons: ['GNSS_DISAGREE'], error_est_ms: 8.0 },
      { node_id: nodeB.id, from: 'quarantined', to: 'recovering', at_ms: 1700000000001, reasons: ['RECOVERY_BAND_OK'], error_est_ms: 2.0 },
      // 6th and 7th should be truncated
      { node_id: nodeA.id, from: 'trusted', to: 'suspect', at_ms: 1700000000000, reasons: ['PEER_OUTLIER'], error_est_ms: 1.0 },
      { node_id: nodeZ.id, from: 'suspect', to: 'trusted', at_ms: 1699999999999, reasons: ['RECOVERY_BAND_OK'], error_est_ms: 0.1 },
    ];

    useDashboardStore.setState({
      nodes: [nodeA, nodeB, nodeZ],
      recentTransitions: transitions,
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    const matches = html.match(/data-testid="transition-row"/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(5);

    // Friendly translated reasons
    expect(html).toContain('Clock jump detected');
    expect(html).toContain('Clock drift exceeded confidence threshold');
    expect(html).toContain('GNSS spoofing detected across cross-validation');
  });

  it('7. Zero real nodes shows the QR hint while virtual nodes remain visible', () => {
    // Only virtual nodes present
    useDashboardStore.setState({
      nodes: [nodeA, nodeZ], // Both are virtual
      isLoading: false,
    });

    const htmlVirtualOnly = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    // Hint must be visible
    expect(htmlVirtualOnly).toContain('data-testid="no-real-nodes-hint"');
    expect(htmlVirtualOnly).toContain('Add a real node: scan the QR.');
    // Virtual node cards must remain rendered
    expect(htmlVirtualOnly).toContain('Alpha-Observatory');
    expect(htmlVirtualOnly).toContain('Zeta-Station');

    // Now add a real node
    useDashboardStore.setState({
      nodes: [nodeA, nodeB], // nodeB is browser (real)
      isLoading: false,
    });

    const htmlWithReal = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    // Hint must now be hidden
    expect(htmlWithReal).not.toContain('data-testid="no-real-nodes-hint"');
  });

  it('8. Missing assessment history does not create fake sparkline data', () => {
    // Node with zero history
    useDashboardStore.setState({
      nodes: [nodeA],
      assessmentHistory: { [nodeA.id]: [] },
      isLoading: false,
    });

    const htmlEmptyHistory = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    expect(htmlEmptyHistory).toContain('data-testid="sparkline-empty"');
    expect(htmlEmptyHistory).toContain('Calibrating...');
    expect(htmlEmptyHistory).not.toContain('data-testid="sparkline-container"');

    // Node with real history >= 2 points
    useDashboardStore.setState({
      nodes: [nodeA],
      assessmentHistory: { [nodeA.id]: [0.2, 0.4, 0.3, 0.5] },
      isLoading: false,
    });

    const htmlWithHistory = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    expect(htmlWithHistory).toContain('data-testid="sparkline-container"');
    expect(htmlWithHistory).toContain('<svg');
  });

  it('9. Loading, error and reconnect states behave correctly', () => {
    // 9a. Loading skeleton
    useDashboardStore.setState({
      isLoading: true,
      nodes: [],
    });

    const htmlLoading = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );
    expect(htmlLoading).toContain('data-testid="skeleton"');

    // 9b. Reconnecting banner
    useDashboardStore.setState({
      connectionStatus: 'connecting',
      isLoading: false,
      nodes: [nodeA],
    });

    const htmlConnecting = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );
    expect(htmlConnecting).toContain('data-testid="reconnecting-notice"');
    expect(htmlConnecting).toContain('Reconnecting to Chronyx Gateway');

    // 9c. Disconnected banner
    useDashboardStore.setState({
      connectionStatus: 'disconnected',
      isLoading: false,
      nodes: [nodeA],
    });

    const htmlDisconnected = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );
    expect(htmlDisconnected).toContain('data-testid="disconnected-notice"');
    expect(htmlDisconnected).toContain('Disconnected from Gateway');

    // 9d. Stream Error Notice
    useDashboardStore.setState({
      error: 'Socket transport closed unexpectedly',
      isLoading: false,
      nodes: [nodeA],
    });

    const htmlError = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );
    expect(htmlError).toContain('Socket transport closed unexpectedly');
  });

  it('10. Primary action renders prominent link to /compare', () => {
    useDashboardStore.setState({
      nodes: [nodeA],
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    expect(html).toContain('data-testid="compare-demo-action"');
    expect(html).toContain('href="/compare"');
    expect(html).toContain('Run the Before vs After demo');
  });

  it('11. Three server-provided virtual nodes render from snapshot, skeletons disappear, and authoritative anchor status is preserved', () => {
    const vNodes: NodeInfo[] = [
      { id: '00000000-0000-0000-0000-000000000001', name: 'V-Alpha', kind: 'virtual', public_key: 'pk1', created_at: '2026-11-20T12:00:00Z', last_seen_at: '2026-11-20T12:00:01Z', online: true },
      { id: '00000000-0000-0000-0000-000000000002', name: 'V-Beta', kind: 'virtual', public_key: 'pk2', created_at: '2026-11-20T12:00:00Z', last_seen_at: '2026-11-20T12:00:01Z', online: true },
      { id: '00000000-0000-0000-0000-000000000003', name: 'V-Gamma', kind: 'virtual', public_key: 'pk3', created_at: '2026-11-20T12:00:00Z', last_seen_at: '2026-11-20T12:00:01Z', online: true },
    ];

    // Apply snapshot with 3 virtual nodes, 98% health, anchor_ok: false (matching health endpoint)
    useDashboardStore.getState().setSnapshot({
      ...mockSnapshot,
      nodes: vNodes,
      network: {
        score: 98,
        n: 3,
        trusted: 3,
        suspect: 0,
        quarantined: 0,
        recovering: 0,
        fault_tolerance_f: 0,
        anchor_ok: false,
      },
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    // Skeletons must disappear
    expect(html).not.toContain('data-testid="skeleton"');

    // All three virtual nodes must render in node grid
    expect(html).toContain('V-Alpha');
    expect(html).toContain('V-Beta');
    expect(html).toContain('V-Gamma');

    // Network health and fault tolerance populated
    expect(html).toContain('98%');
    expect(html).toContain('Tolerates 0 faulty of 3 nodes');

    // Authoritative anchor status (anchor_ok: false) must be reflected
    expect(html).toContain('Anchors Unavailable');
    expect(html).not.toContain('Anchors OK');

    // Zero real nodes hint must be rendered
    expect(html).toContain('Add a real node: scan the QR.');
  });

  it('12. Authoritative anchor status never defaults to OK when awaiting snapshot', () => {
    useDashboardStore.setState({
      network: null,
      anchors: [],
      nodes: [nodeA],
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(MemoryRouter, null, React.createElement(OverviewPage, null)),
    );

    expect(html).toContain('Anchors Unavailable');
    expect(html).not.toContain('Anchors OK');
  });
});
