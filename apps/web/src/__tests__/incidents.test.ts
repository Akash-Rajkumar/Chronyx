// TEST-FIXTURE
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  IncidentsPage,
  calculateSeverity,
  formatDuration,
  formatSignedOffset,
  CAUSE_LABELS,
} from '../pages/incidents/IncidentsPage.js';
import { useDashboardStore } from '../state/useDashboardStore.js';
import type { IncidentSummary, NodeInfo } from '@chronyx/contracts';

describe('Incidents Page (P3-T5)', () => {
  const node1Id = '11111111-1111-1111-1111-111111111111';
  const node2Id = '22222222-2222-2222-2222-222222222222';

  const mockNode1: NodeInfo = {
    id: node1Id,
    name: 'V-Alpha',
    kind: 'virtual',
    public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000000=',
    created_at: '2026-11-20T12:00:00.000Z',
    last_seen_at: '2026-11-20T12:05:00.000Z',
    online: true,
  };

  const sampleOpenIncident: IncidentSummary = {
    id: 'aaaa1111-1111-1111-1111-111111111111',
    node_id: node1Id,
    node_name: 'V-Alpha',
    status: 'open',
    opened_at_ms: 1700000000000,
    closed_at_ms: null,
    peak_error_ms: 12.45,
    detection_latency_s: 1.5,
    cause: 'gnss_spoof',
  };

  const sampleClosedIncident: IncidentSummary = {
    id: 'bbbb2222-2222-2222-2222-222222222222',
    node_id: node2Id,
    node_name: 'V-Beta',
    status: 'closed',
    opened_at_ms: 1699990000000,
    closed_at_ms: 1699990150000, // 150s duration = 2m 30s
    peak_error_ms: 3.2,
    detection_latency_s: 2.1,
    cause: 'local_clock',
  };

  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  const renderPage = () => {
    return renderToString(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(IncidentsPage, null),
      ),
    );
  };

  it('renders incidents page title and KPI counters', () => {
    useDashboardStore.setState({
      openIncidents: [sampleOpenIncident],
      isLoading: false,
    });

    const html = renderPage();
    expect(html).toContain('Incident Log');
    expect(html).toContain('data-testid="kpi-total"');
    expect(html).toContain('data-testid="kpi-open"');
    expect(html).toContain('data-testid="kpi-closed"');
    expect(html).toContain('data-testid="kpi-peak"');
  });

  it('renders populated incidents list with node links, cause and status chips', () => {
    useDashboardStore.setState({
      openIncidents: [sampleOpenIncident],
      isLoading: false,
    });

    const html = renderPage();
    expect(html).toContain('data-testid="incident-row-aaaa1111-1111-1111-1111-111111111111"');
    expect(html).toContain('V-Alpha');
    expect(html).toContain('GNSS Carrier Spoofing');
    expect(html).toContain('Critical');
    expect(html).toContain('open');
    expect(html).toContain('+12.450 ms');
    expect(html).toContain('1.5s');
    expect(html).toContain('data-testid="view-incident-aaaa1111-1111-1111-1111-111111111111"');
  });

  it('renders empty state when zero incidents are present', () => {
    useDashboardStore.setState({
      openIncidents: [],
      isLoading: false,
    });

    const html = renderPage();
    expect(html).toContain('data-testid="incidents-empty-state"');
    expect(html).toContain('No Incidents Recorded');
    expect(html).toContain('The cluster is running nominally');
  });

  it('displays disconnected notice when gateway socket is offline', () => {
    useDashboardStore.setState({
      openIncidents: [sampleOpenIncident],
      connectionStatus: 'disconnected',
      isLoading: false,
    });

    const html = renderPage();
    expect(html).toContain('data-testid="incidents-disconnected-banner"');
    expect(html).toContain('Gateway Disconnected. Displaying cached incident history.');
    expect(html).toContain('Offline');
  });

  it('includes filter controls for status tabs, nodes, and severity', () => {
    useDashboardStore.setState({
      openIncidents: [sampleOpenIncident],
      nodes: [mockNode1],
      isLoading: false,
    });

    const html = renderPage();
    expect(html).toContain('data-testid="filter-status-all"');
    expect(html).toContain('data-testid="filter-status-open"');
    expect(html).toContain('data-testid="filter-status-closed"');
    expect(html).toContain('data-testid="filter-node-select"');
    expect(html).toContain('data-testid="filter-severity-select"');
    expect(html).toContain('data-testid="incidents-search-input"');
    expect(html).toContain('data-testid="refresh-incidents-button"');
  });

  it('renders both open and closed incidents when available in state', () => {
    useDashboardStore.setState({
      openIncidents: [sampleOpenIncident, sampleClosedIncident],
      isLoading: false,
    });

    const html = renderPage();
    expect(html).toContain('V-Alpha');
    expect(html).toContain('V-Beta');
    expect(html).toContain('GNSS Carrier Spoofing');
    expect(html).toContain('Local Clock Drift / Step');
  });

  describe('Incident Helper Calculations', () => {
    it('calculates severity correctly based on peak error and cause', () => {
      // Critical (>= 10ms or gnss_spoof)
      expect(calculateSeverity(12.5).severity).toBe('critical');
      expect(calculateSeverity(0.5, 'gnss_spoof').severity).toBe('critical');

      // High (>= 5ms or local_clock)
      expect(calculateSeverity(6.2).severity).toBe('high');
      expect(calculateSeverity(2.0, 'local_clock').severity).toBe('high');

      // Medium (>= 1ms or network)
      expect(calculateSeverity(1.8).severity).toBe('medium');
      expect(calculateSeverity(0.3, 'network').severity).toBe('medium');

      // Low (< 1ms)
      expect(calculateSeverity(0.4).severity).toBe('low');
    });

    it('formats duration correctly for open and closed incidents', () => {
      // 150 seconds -> 2m 30s
      expect(formatDuration(1000, 151000)).toBe('2m 30s');
      // 45 seconds
      expect(formatDuration(1000, 46000)).toBe('45s');
      // 3700 seconds -> 1h 1m
      expect(formatDuration(1000, 3701000)).toBe('1h 1m');
    });

    it('formats signed offset accurately', () => {
      expect(formatSignedOffset(12.45)).toBe('+12.450 ms');
      expect(formatSignedOffset(-3.21)).toBe('-3.210 ms');
      expect(formatSignedOffset(0)).toBe('+0.000 ms');
      expect(formatSignedOffset(null)).toBe('0.000 ms');
      expect(formatSignedOffset(undefined)).toBe('0.000 ms');
    });

    it('maps cause labels comprehensively', () => {
      expect(CAUSE_LABELS.none).toBe('No Specific Cause');
      expect(CAUSE_LABELS.local_clock).toBe('Local Clock Drift / Step');
      expect(CAUSE_LABELS.gnss_spoof).toBe('GNSS Carrier Spoofing');
      expect(CAUSE_LABELS.camera_path).toBe('Optical Delay / Frame Strobe');
      expect(CAUSE_LABELS.network).toBe('Network Asymmetry / Peer Outlier');
      expect(CAUSE_LABELS.unknown).toBe('Undetermined Anomaly');
    });
  });
});
