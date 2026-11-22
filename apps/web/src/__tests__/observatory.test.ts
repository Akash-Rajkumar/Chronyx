// TEST-FIXTURE
import React from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import type { Assessment, Fault, NodeInfo } from '@chronyx/contracts';
import {
  landDots,
  rotate,
  slerp,
  toVec,
} from '../components/ui/route-globe-utils/globe.js';
import { ObservatoryPage } from '../pages/observatory/ObservatoryPage.js';
import { NodeInspectorPanel } from '../pages/observatory/NodeInspectorPanel.js';
import { AppShell } from '../shell/AppShell.js';
import { useDashboardStore } from '../state/useDashboardStore.js';
import { useQrModalStore } from '../state/useQrModalStore.js';

describe('Global Observatory Globe & TopNav Integration', () => {
  const vAlpha: NodeInfo = {
    id: '86ddb509-4412-41f4-8945-4ebf461706fc',
    name: 'V-Alpha',
    kind: 'virtual',
    public_key: 'MCowBQYDK2VwAyEAA000000000000000000000000000000000000000000=',
    created_at: '2026-11-22T00:00:00.000Z',
    last_seen_at: '2026-11-22T00:00:05.000Z',
    online: true,
  };

  const browserNode: NodeInfo = {
    id: 'fcaa24d0-468e-4d5f-90d3-30eb60d38ec2',
    name: 'Judge-Node',
    kind: 'browser',
    public_key: 'MCowBQYDK2VwAyEBB000000000000000000000000000000000000000000=',
    created_at: '2026-11-22T00:00:00.000Z',
    last_seen_at: '2026-11-22T00:00:05.000Z',
    online: true,
  };

  const trustedAssessment: Assessment = {
    node_id: vAlpha.id,
    t_ms: 1700000005000,
    state: 'trusted',
    error_est_ms: 0.12,
    sigma_ms: 0.35,
    z: 0.4,
    cusum: 0.2,
    confidence: 0.96,
    streams: [],
    reasons: [],
    suspected_cause: 'none',
    quarantined_since_ms: null,
  };

  const quarantinedAssessment: Assessment = {
    ...trustedAssessment,
    state: 'quarantined',
    error_est_ms: 10.2,
    z: 8.4,
    cusum: 6.2,
    confidence: 0.12,
    reasons: ['PEER_OUTLIER', 'CUSUM_DRIFT'],
    suspected_cause: 'local_clock',
    quarantined_since_ms: 1700000004000,
  };

  beforeEach(() => {
    useDashboardStore.getState().reset();
    useQrModalStore.getState().reset();
  });

  it('globe math helpers produce valid unit vectors, rotations, slerp and world land dots', () => {
    const v = toVec(0, 0);
    expect(v[0]).toBeCloseTo(0, 5);
    expect(v[1]).toBeCloseTo(0, 5);
    expect(v[2]).toBeCloseTo(1, 5);

    const rot = rotate(toVec(30, 20), (30 * Math.PI) / 180, 0);
    expect(rot[0]).toBeCloseTo(0, 5);
    expect(rot[2]).toBeGreaterThan(0.9);

    const mid = slerp(toVec(0, 0), toVec(90, 0), 0.5);
    expect(Math.hypot(mid[0], mid[1], mid[2])).toBeCloseTo(1, 5);

    const dots = landDots(4000);
    expect(dots.length).toBeGreaterThan(500);
    expect(dots.length).toBeLessThan(3000);
  });

  it('renders real Chronyx nodes on the globe with trust labels and zero demonstration destinations', () => {
    useDashboardStore.setState({
      nodes: [vAlpha, browserNode],
      assessments: { [vAlpha.id]: trustedAssessment },
      isLoading: false,
    });

    const html = renderToString(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/overview'] },
        React.createElement(ObservatoryPage),
      ),
    );

    expect(html).toContain('V-Alpha');
    expect(html).toContain('Judge-Node');
    expect(html).toContain('SIMULATED · TRUSTED · ONLINE');
    expect(html).toContain('JOIN AS A NODE');
    expect(html).not.toContain('Muscat');
    expect(html).not.toContain('Istanbul');
    expect(html).not.toContain('Zanzibar');
  });

  it('renders AppShell with floating TopNav (6 required links) and no legacy sidebar', () => {
    const html = renderToString(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/overview'] },
        React.createElement(AppShell, null, React.createElement('div', null, 'GlobeContent')),
      ),
    );

    expect(html).toContain('Before vs After');
    expect(html).toContain('Red-Team Console');
    expect(html).toContain('Science Impact');
    expect(html).toContain('Scoreboard');
    expect(html).toContain('Incidents');
    expect(html).toContain('Timing Passport');
    expect(html).not.toContain('<aside class="w-64');
  });

  it('renders NodeInspectorPanel with fault controls, quarantined state, and MORE DETAILS link', () => {
    const activeFault: Fault = {
      id: '11111111-1111-4111-8111-111111111111',
      node_id: vAlpha.id,
      type: 'clock_step',
      params: { offset_ms: 10, duration_s: null },
      started_at_ms: 1700000002000,
      ends_at_ms: null,
      status: 'active',
      applies_to: 'sim',
      detected_at_ms: 1700000004000,
      error_at_detect_ms: 10.1,
      detection_latency_s: 2.0,
    };

    const html = renderToString(
      React.createElement(
        MemoryRouter,
        null,
        React.createElement(NodeInspectorPanel, {
          node: vAlpha,
          assessment: quarantinedAssessment,
          activeFaults: [activeFault],
          onClose: () => {},
          onFaultChanged: () => {},
        }),
      ),
    );

    expect(html).toContain('V-Alpha');
    expect(html).toContain('QUARANTINED BY CONSENSUS');
    expect(html).toContain('Clock Step');
    expect(html).toContain('Clock Ramp');
    expect(html).toContain('GNSS Spoof');
    expect(html).toContain('Camera Delay');
    expect(html).toContain('Noise Burst');
    expect(html).toContain('MORE DETAILS');
    expect(html).toContain(`href="/nodes/${vAlpha.id}"`);
  });
});
