// TEST-FIXTURE
import { createElement } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mockFault, mockNodeInfo, mockSnapshot } from '@chronyx/contracts';
import { useDashboardStore } from '../../state/useDashboardStore.js';
import { RedTeamPage } from './RedTeamPage.js';

function renderRedTeamPage(): string {
  return renderToString(
    createElement(MemoryRouter, null, createElement(RedTeamPage)),
  );
}

describe('RedTeamPage (/redteam)', () => {
  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  it('renders loading skeletons when loading with no nodes', () => {
    const html = renderRedTeamPage();
    expect(html).toContain('animate-pulse');
  });

  it('renders safety banner and empty state when loaded with no nodes', () => {
    useDashboardStore.getState().setLoading(false);
    const html = renderRedTeamPage();
    expect(html).toContain('Software-only simulation. No signals are transmitted.');
    expect(html).toContain('No observatory nodes online');
  });

  it('renders error state when store error is present and no nodes exist', () => {
    useDashboardStore.getState().setError('Backend unreachable');
    const html = renderRedTeamPage();
    expect(html).toContain('Unable to load observatory nodes');
    expect(html).toContain('Backend unreachable');
  });

  it('renders node cards, fault options, Start button, and active faults from store', () => {
    const snap = JSON.parse(JSON.stringify(mockSnapshot));
    snap.faults = [mockFault];
    useDashboardStore.getState().setSnapshot(snap);

    const html = renderRedTeamPage();
    expect(html).toContain('Software-only simulation. No signals are transmitted.');
    expect(html).toContain('data-testid="redteam-start"');
    expect(html).toContain('data-testid="redteam-active-faults"');
    expect(html).toContain(mockNodeInfo.name);
    expect(html).toContain('Detected in 3.0 s');
    expect(html).toContain('Stop');
  });

  it('disables virtual-only fault types when only a browser node is present', () => {
    const snap = JSON.parse(JSON.stringify(mockSnapshot));
    snap.nodes = [{ ...mockNodeInfo, kind: 'browser', name: 'Judge-1234' }];
    useDashboardStore.getState().setSnapshot(snap);

    const html = renderRedTeamPage();
    expect(html).toContain('Judge-1234');
    expect(html).toContain('Virtual nodes only: browser nodes do not simulate GNSS or camera-trigger streams.');
  });
});
