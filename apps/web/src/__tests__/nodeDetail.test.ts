// TEST-FIXTURE
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { NodeDetailPage, formatSignedOffset } from '../pages/node/NodeDetailPage.js';
import { useDashboardStore } from '../state/useDashboardStore.js';
import type { NodeInfo, Assessment, Transition } from '@chronyx/contracts';

describe('Node Detail Page (P3-T4)', () => {
  const browserNodeId = '11111111-1111-1111-1111-111111111111';
  const virtualNodeId = '22222222-2222-2222-2222-222222222222';

  const realBrowserNode: NodeInfo = {
    id: browserNodeId,
    name: 'Browser-Alpha-Node',
    kind: 'browser',
    public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000000=',
    created_at: '2026-11-20T12:00:00.000Z',
    last_seen_at: '2026-11-20T12:05:00.000Z',
    online: true,
  };

  const virtualStationNode: NodeInfo = {
    id: virtualNodeId,
    name: 'Virtual-Observatory-Beta',
    kind: 'virtual',
    public_key: 'MCowBQYDK2VwAyEAA111111111111111111111111111111111111111111=',
    created_at: '2026-11-20T12:00:00.000Z',
    last_seen_at: '2026-11-20T12:06:00.000Z',
    online: true,
  };

  const nominalAssessment: Assessment = {
    node_id: browserNodeId,
    t_ms: 1700000000000,
    state: 'trusted',
    error_est_ms: 0.125,
    sigma_ms: 0.045,
    z: 0.85,
    cusum: 1.2,
    confidence: 0.98,
    streams: [
      { stream: 'peer', residual_ms: 0.12, z: 0.8, flagged: false },
      { stream: 'oscillator', residual_ms: 0.05, z: 0.4, flagged: false },
    ],
    reasons: [],
    suspected_cause: 'none',
    quarantined_since_ms: null,
  };

  const flaggedAssessment: Assessment = {
    node_id: virtualNodeId,
    t_ms: 1700000000000,
    state: 'suspect',
    error_est_ms: 4.85,
    sigma_ms: 0.35,
    z: 4.2,
    cusum: 6.8,
    confidence: 0.32,
    streams: [
      { stream: 'peer', residual_ms: 4.8, z: 4.2, flagged: true },
      { stream: 'oscillator', residual_ms: 0.1, z: 0.6, flagged: false },
      { stream: 'gnss', residual_ms: 5.1, z: 4.5, flagged: true },
      { stream: 'camera', residual_ms: 4.9, z: 4.3, flagged: true },
    ],
    reasons: ['CUSUM_DRIFT', 'GNSS_DISAGREE'],
    suspected_cause: 'gnss_spoof',
    quarantined_since_ms: null,
  };

  const sampleTransition: Transition = {
    node_id: virtualNodeId,
    from: 'trusted',
    to: 'suspect',
    at_ms: 1700000005000,
    reasons: ['CUSUM_DRIFT'],
    error_est_ms: 4.85,
  };

  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  const renderPage = (initialPath: string) => {
    return renderToString(
      React.createElement(
        MemoryRouter,
        { initialEntries: [initialPath] },
        React.createElement(
          Routes,
          null,
          React.createElement(Route, {
            path: '/nodes/:id',
            element: React.createElement(NodeDetailPage, null),
          }),
        ),
      ),
    );
  };

  it('renders loading skeleton when state is loading and node is absent', () => {
    useDashboardStore.setState({
      nodes: [],
      isLoading: true,
    });

    const html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('data-testid="node-detail-loading"');
  });

  it('renders not-found state when node is missing and not loading', () => {
    useDashboardStore.setState({
      nodes: [],
      isLoading: false,
    });

    const html = renderPage(`/nodes/non-existent-id`);
    expect(html).toContain('data-testid="node-detail-not-found"');
    expect(html).toContain('Node Not Found');
    expect(html).toContain('non-existent-id');
    expect(html).toContain('Return to Overview');
  });

  it('renders real browser node identity with distinct Real Node badge and public key', () => {
    useDashboardStore.setState({
      nodes: [realBrowserNode],
      assessments: { [browserNodeId]: nominalAssessment },
      isLoading: false,
    });

    const html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('Browser-Alpha-Node');
    expect(html).toContain('Real Node');
    expect(html).toContain('Online');
    expect(html).toContain('Copy');
    expect(html).toContain('MCowBQYDK2');
  });

  it('renders virtual node with Virtual Node badge and all 4 stream active annotations', () => {
    useDashboardStore.setState({
      nodes: [virtualStationNode],
      assessments: { [virtualNodeId]: flaggedAssessment },
      isLoading: false,
    });

    const html = renderPage(`/nodes/${virtualNodeId}`);
    expect(html).toContain('Virtual-Observatory-Beta');
    expect(html).toContain('Virtual Node');
    expect(html).toContain('Active (Sim)');
  });

  it('marks GNSS and Optical Camera as Not Equipped on real browser nodes', () => {
    useDashboardStore.setState({
      nodes: [realBrowserNode],
      assessments: { [browserNodeId]: nominalAssessment },
      isLoading: false,
    });

    const html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('Not Equipped (Virtual Nodes Only)');
    expect(html).toContain('Standard browsers lack direct GNSS hardware PPS access');
  });

  it('displays evaluated trust state chip and confidence percentage', () => {
    useDashboardStore.setState({
      nodes: [realBrowserNode],
      assessments: { [browserNodeId]: nominalAssessment },
      isLoading: false,
    });

    const html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('data-testid="trust-state-section"');
    expect(html).toContain('98');
    expect(html).toContain('% conf');
  });

  it('displays CUSUM and Robust Z-score indicators within normal thresholds', () => {
    useDashboardStore.setState({
      nodes: [realBrowserNode],
      assessments: { [browserNodeId]: nominalAssessment },
      isLoading: false,
    });

    const html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('Threshold h = 4.0σ');
    expect(html).toContain('1.20');
    expect(html).toContain('Nominal: Residual accumulation within normal Brownian perturbation limits.');
    expect(html).toContain('Threshold |z| = 3.0');
    expect(html).toContain('0.85');
    expect(html).toContain('Within tolerance: Timing error consistent with synchronized cluster reference.');
  });

  it('displays flagged anomaly alerts when CUSUM and Z-score exceed decision thresholds', () => {
    useDashboardStore.setState({
      nodes: [virtualStationNode],
      assessments: { [virtualNodeId]: flaggedAssessment },
      isLoading: false,
    });

    const html = renderPage(`/nodes/${virtualNodeId}`);
    expect(html).toContain('6.80');
    expect(html).toContain('Flagged: Accumulator exceeds decision boundary!');
    expect(html).toContain('4.20');
    expect(html).toContain('Anomaly detected: Node timing residual deviates significantly from the observatory median.');
  });

  it('displays calibrating state when telemetry history has fewer than 2 samples', () => {
    useDashboardStore.setState({
      nodes: [realBrowserNode],
      assessments: { [browserNodeId]: nominalAssessment },
      assessmentHistory: { [browserNodeId]: [0.125] }, // 1 sample
      isLoading: false,
    });

    const html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('data-testid="calibrating-state"');
    expect(html).toContain('Calibrating Observatory Baseline');
    expect(html).toContain('Residual chart requires at least 2 historical consensus points');
  });

  it('displays SVG time-series chart when telemetry history has 2 or more samples', () => {
    useDashboardStore.setState({
      nodes: [realBrowserNode],
      assessments: { [browserNodeId]: nominalAssessment },
      assessmentHistory: { [browserNodeId]: [0.125, 0.130, 0.128, 0.135] },
      isLoading: false,
    });

    const html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('data-testid="timeseries-chart"');
    expect(html).toContain('<polyline');
    expect(html).toContain('samples');
    expect(html).toContain('data-testid="sample-count"');
  });

  it('displays node-specific transitions when present, and empty state when absent', () => {
    // When transitions are empty
    useDashboardStore.setState({
      nodes: [realBrowserNode],
      assessments: { [browserNodeId]: nominalAssessment },
      recentTransitions: [],
      isLoading: false,
    });

    let html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('data-testid="transitions-empty"');
    expect(html).toContain('No state transitions recorded for this node');

    // When node transition is present
    useDashboardStore.setState({
      nodes: [virtualStationNode],
      assessments: { [virtualNodeId]: flaggedAssessment },
      recentTransitions: [sampleTransition],
      isLoading: false,
    });

    html = renderPage(`/nodes/${virtualNodeId}`);
    expect(html).toContain('data-testid="transition-item-0"');
    expect(html).toContain('trusted');
    expect(html).toContain('suspect');
    expect(html).toContain('CUSUM_DRIFT');
  });

  it('includes export evidence bundle action button', () => {
    useDashboardStore.setState({
      nodes: [realBrowserNode],
      assessments: { [browserNodeId]: nominalAssessment },
      isLoading: false,
    });

    const html = renderPage(`/nodes/${browserNodeId}`);
    expect(html).toContain('data-testid="export-evidence-button"');
    expect(html).toContain('Export Evidence Bundle');
  });

  it('formats signed offset helper correctly', () => {
    expect(formatSignedOffset(0.1234)).toBe('+0.123 ms');
    expect(formatSignedOffset(-0.5678)).toBe('-0.568 ms');
    expect(formatSignedOffset(0)).toBe('+0.000 ms');
    expect(formatSignedOffset(null)).toBe('0.000 ms');
    expect(formatSignedOffset(undefined)).toBe('0.000 ms');
  });
});
