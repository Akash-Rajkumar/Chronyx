// TEST-FIXTURE
import { createElement } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mockSnapshot } from '@chronyx/contracts';
import { useDashboardStore } from '../../state/useDashboardStore.js';
import { ComparePage } from './ComparePage.js';

function renderComparePage(): string {
  return renderToString(
    createElement(MemoryRouter, null, createElement(ComparePage)),
  );
}

describe('ComparePage (/compare)', () => {
  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  it('renders loading skeletons when loading with no snapshot data', () => {
    const html = renderComparePage();
    expect(html).toContain('animate-pulse');
  });

  it('renders empty state when loaded with no nodes or baseline', () => {
    useDashboardStore.getState().setLoading(false);
    const html = renderComparePage();
    expect(html).toContain('No observatory nodes online yet');
  });

  it('renders error state when store error is present and no data exists', () => {
    useDashboardStore.getState().setError('Socket connection refused');
    const html = renderComparePage();
    expect(html).toContain('Unable to load comparison telemetry');
    expect(html).toContain('Socket connection refused');
  });

  it('renders split-screen panels, scenario controls, and baseline label from snapshot', () => {
    useDashboardStore.getState().setSnapshot(JSON.parse(JSON.stringify(mockSnapshot)));
    const html = renderComparePage();

    expect(html).toContain('data-testid="scenario-bar"');
    expect(html).toContain('Calm');
    expect(html).toContain('Jump');
    expect(html).toContain('Slow drag');
    expect(html).toContain('GNSS spoof');

    expect(html).toContain('data-testid="compare-left"');
    expect(html).toContain(mockSnapshot.baseline.label);
    expect(html).toContain('No alarm raised');

    expect(html).toContain('data-testid="compare-right"');
    expect(html).toContain('Chronyx Verified');
    expect(html).toContain(mockSnapshot.nodes[0]!.name);

    expect(html).toContain('data-testid="compare-chart"');
    expect(html).toContain('data-testid="metrics-strip"');
    expect(html).toContain('See what this does to the science');
  });
});
