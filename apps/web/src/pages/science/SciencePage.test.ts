// TEST-FIXTURE
import { createElement } from 'react';
import { describe, it, expect, beforeEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { mockFault, mockSnapshot } from '@chronyx/contracts';
import { useDashboardStore } from '../../state/useDashboardStore.js';
import { SciencePage } from './SciencePage.js';

function renderSciencePage(): string {
  return renderToString(
    createElement(MemoryRouter, null, createElement(SciencePage)),
  );
}

describe('SciencePage (/science)', () => {
  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  it('renders prescribed explanation, controls, and the three frozen science panel testids', () => {
    const html = renderSciencePage();
    expect(html).toContain('At 20 km/s, 1 ms of timing error moves a chord by 20 m.');
    expect(html).toContain('Use the live fault');
    expect(html).toContain('Simulated geometry');
    expect(html).toContain('data-testid="science-panel-truth"');
    expect(html).toContain('data-testid="science-panel-trusted"');
    expect(html).toContain('data-testid="science-panel-quarantined"');
  });

  it('uses params.offset_ms (not error_at_detect_ms) for clock_step faults', () => {
    const snap = JSON.parse(JSON.stringify(mockSnapshot));
    snap.faults = [{ ...mockFault, type: 'clock_step', params: { offset_ms: 10 }, error_at_detect_ms: 10.05 }];
    useDashboardStore.getState().setSnapshot(snap);

    const html = renderSciencePage();
    expect(html).toContain('Active clock_step: 10.0 ms (params.offset_ms)');
    expect(html).not.toContain('10.1 ms');
  });

  it('disables Use the live fault with explanation for ramp/spoof/noise faults without fixed offset_ms', () => {
    const snap = JSON.parse(JSON.stringify(mockSnapshot));
    snap.faults = [
      {
        ...mockFault,
        type: 'clock_ramp',
        params: { rate_ms_per_min: 0.5 },
        error_at_detect_ms: 4.2,
      },
    ];
    useDashboardStore.getState().setSnapshot(snap);

    const html = renderSciencePage();
    expect(html).toContain('Active clock_ramp fault has no fixed injected offset_ms size');
    expect(html).toContain('disabled=""');
  });

  it('disables Use the live fault instead of clamping when offset_ms exceeds 20 ms', () => {
    const snap = JSON.parse(JSON.stringify(mockSnapshot));
    snap.faults = [
      {
        ...mockFault,
        type: 'clock_step',
        params: { offset_ms: 35 },
      },
    ];
    useDashboardStore.getState().setSnapshot(snap);

    const html = renderSciencePage();
    expect(html).toContain(
      'Active clock_step offset (35.0 ms) exceeds the 0–20 ms science replay slider range',
    );
    expect(html).toContain('disabled=""');
  });
});
