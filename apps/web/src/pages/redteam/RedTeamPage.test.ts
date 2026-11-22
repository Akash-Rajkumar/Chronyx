// TEST-FIXTURE
import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import {
  mockFault,
  mockNodeInfo,
  mockObservation,
  mockSnapshot,
  ObservationCreateSchema,
} from '@chronyx/contracts';
import type { Observation } from '@chronyx/contracts';
import { api } from '../../api/client.js';
import { useDashboardStore } from '../../state/useDashboardStore.js';
import { RedTeamPage } from './RedTeamPage.js';
import {
  ObservationResultCard,
  submitTestObservation,
} from './TestObservationCard.js';

function renderRedTeamPage(): string {
  return renderToString(
    createElement(MemoryRouter, null, createElement(RedTeamPage)),
  );
}

function renderObservationResult(observation: Observation): string {
  return renderToString(
    createElement(MemoryRouter, null, createElement(ObservationResultCard, { observation })),
  );
}

describe('RedTeamPage (/redteam)', () => {
  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
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

  it('renders node cards, fault options, Start button, active faults, and test observation form from store', () => {
    const snap = JSON.parse(JSON.stringify(mockSnapshot));
    snap.faults = [mockFault];
    useDashboardStore.getState().setSnapshot(snap);

    const html = renderRedTeamPage();
    expect(html).toContain('Software-only simulation. No signals are transmitted.');
    expect(html).toContain('data-testid="redteam-start"');
    expect(html).toContain('data-testid="redteam-active-faults"');
    expect(html).toContain('data-testid="redteam-observation-card"');
    expect(html).toContain('data-testid="redteam-submit-observation"');
    expect(html).toContain('Submit Test Observation');
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

  it('submits a contract-valid test observation through api.createObservation()', async () => {
    const spy = vi.spyOn(api, 'createObservation').mockResolvedValue(mockObservation);

    const created = await submitTestObservation({
      nodeId: mockNodeInfo.id,
      kind: 'occultation_timing',
      observedAtMs: 1700000010000,
      note: 'Chord ingress check',
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const submittedPayload = spy.mock.calls[0]?.[0];
    expect(ObservationCreateSchema.safeParse(submittedPayload).success).toBe(true);
    expect(submittedPayload).toEqual({
      node_id: mockNodeInfo.id,
      kind: 'occultation_timing',
      observed_at_ms: 1700000010000,
      payload: { source: 'redteam_console', note: 'Chord ingress check' },
    });
    expect(created).toEqual(mockObservation);
  });

  it('links to /passport/{id} when observation status is accepted', () => {
    const obs: Observation = {
      ...mockObservation,
      id: '00000000-0000-0000-0000-000000000031',
      status: 'accepted',
      state_at_ingest: 'trusted',
    };

    const html = renderObservationResult(obs);
    expect(html).toContain('accepted');
    expect(html).toContain(`href="/passport/${obs.id}"`);
    expect(html).toContain('View Timing Passport');
  });

  it('links to /passport/{id} when observation status is released', () => {
    const obs: Observation = {
      ...mockObservation,
      id: '00000000-0000-0000-0000-000000000032',
      status: 'released',
      state_at_ingest: 'recovering',
    };

    const html = renderObservationResult(obs);
    expect(html).toContain('released');
    expect(html).toContain(`href="/passport/${obs.id}"`);
    expect(html).toContain('View Timing Passport');
  });

  it('explains held status based on node trust state at ingest', () => {
    const obs: Observation = {
      ...mockObservation,
      id: '00000000-0000-0000-0000-000000000033',
      status: 'held',
      state_at_ingest: 'quarantined',
    };

    const html = renderObservationResult(obs);
    expect(html).toContain('held');
    expect(html).toContain('Held based on node trust state at ingest (quarantined)');
    expect(html).not.toContain(`href="/passport/${obs.id}"`);
  });

  it('shows a neutral rejected message without inventing a reason when observation status is rejected', () => {
    const obs: Observation = {
      ...mockObservation,
      id: '00000000-0000-0000-0000-000000000034',
      status: 'rejected',
      state_at_ingest: 'quarantined',
      payload: { source: 'redteam_console', rejection_reason: 'non-contract-payload-key' },
    };

    const html = renderObservationResult(obs);
    expect(html).toContain('rejected');
    expect(html).toContain('Observation was rejected.');
    expect(html).not.toContain('non-contract-payload-key');
    expect(html).not.toContain('rejected based on');
    expect(html).not.toContain(`href="/passport/${obs.id}"`);
  });
});
