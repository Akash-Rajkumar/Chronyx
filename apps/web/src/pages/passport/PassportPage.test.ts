// TEST-FIXTURE
import { createElement } from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { mockPassport, mockSnapshot } from '@chronyx/contracts';
import { api, ApiError } from '../../api/client.js';
import { useDashboardStore } from '../../state/useDashboardStore.js';
import {
  PassportPage,
  loadPassportById,
  type PassportLoadState,
} from './PassportPage.js';

function renderPassportRoute(
  path: string,
  initialState?: PassportLoadState,
  defaultRevealEvidence?: boolean,
): string {
  const props: { initialState?: PassportLoadState; defaultRevealEvidence?: boolean } = {};
  if (initialState) props.initialState = initialState;
  if (defaultRevealEvidence !== undefined) props.defaultRevealEvidence = defaultRevealEvidence;
  const pageElement = createElement(
    PassportPage,
    Object.keys(props).length > 0 ? props : null,
  );
  return renderToString(
    createElement(
      MemoryRouter,
      { initialEntries: [path] },
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: '/passport',
          element: pageElement,
        }),
        createElement(Route, {
          path: '/passport/:id',
          element: pageElement,
        }),
      ),
    ),
  );
}

describe('PassportPage (/passport/:id)', () => {
  beforeEach(() => {
    useDashboardStore.getState().reset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renders loading skeletons when loading a passport by route ID', () => {
    const html = renderPassportRoute(`/passport/${mockPassport.observation_id}`, {
      kind: 'loading',
    });
    expect(html).toContain('data-testid="passport-loading"');
    expect(html).toContain('animate-pulse');
  });

  it('renders empty state when visited without an observation ID', () => {
    const html = renderPassportRoute('/passport');
    expect(html).toContain('data-testid="passport-empty"');
    expect(html).toContain('No observation selected');
    expect(html).toContain('href="/redteam"');
  });

  it('renders not-found state with retry and Red-Team link', () => {
    const html = renderPassportRoute(`/passport/${mockPassport.observation_id}`, {
      kind: 'not_found',
      message: 'Observation passport not found',
    });
    expect(html).toContain('data-testid="passport-not-found"');
    expect(html).toContain('Timing passport not found');
    expect(html).toContain('Observation passport not found');
    expect(html).toContain('Retry');
    expect(html).toContain('href="/redteam"');
  });

  it('renders error state with retry action on API error', () => {
    const html = renderPassportRoute(`/passport/${mockPassport.observation_id}`, {
      kind: 'error',
      message: 'Gateway timeout',
    });
    expect(html).toContain('data-testid="passport-error"');
    expect(html).toContain('Unable to load timing passport');
    expect(html).toContain('Gateway timeout');
    expect(html).toContain('Retry');
  });

  it('masks critical hashes and signature by default with eye reveal toggles, and renders exact contract values when revealed', () => {
    useDashboardStore.getState().setSnapshot(JSON.parse(JSON.stringify(mockSnapshot)));
    useDashboardStore.getState().setConnectionStatus('mock');

    const maskedHtml = renderPassportRoute(`/passport/${mockPassport.observation_id}`, {
      kind: 'ready',
      passport: mockPassport,
    }).replace(/<!-- -->/g, '');

    expect(maskedHtml).toContain('data-testid="passport-detail"');
    expect(maskedHtml).toContain('SIMULATED (MOCK)');
    expect(maskedHtml).toContain('Encrypted');
    expect(maskedHtml).toContain('data-testid="passport-toggle-evidence_hash"');
    expect(maskedHtml).toContain('data-testid="passport-toggle-chain_head_hash"');
    expect(maskedHtml).toContain('data-testid="passport-toggle-server_public_key"');
    expect(maskedHtml).toContain('data-testid="passport-toggle-sig"');
    expect(maskedHtml).not.toContain(mockPassport.evidence_hash);
    expect(maskedHtml).not.toContain(mockPassport.sig);

    const revealedHtml = renderPassportRoute(
      `/passport/${mockPassport.observation_id}`,
      {
        kind: 'ready',
        passport: mockPassport,
      },
      true,
    ).replace(/<!-- -->/g, '');

    expect(revealedHtml).toContain(mockPassport.observation_id);
    expect(revealedHtml).toContain(mockPassport.node_id);
    expect(revealedHtml).toContain(`href="/nodes/${mockPassport.node_id}"`);
    expect(revealedHtml).toContain(mockPassport.state_at_observation);
    expect(revealedHtml).toContain('99%');
    expect(revealedHtml).toContain('+0.12 ms');
    expect(revealedHtml).toContain('±0.28 ms');
    expect(revealedHtml).toContain(mockPassport.evidence_hash);
    expect(revealedHtml).toContain(mockPassport.chain_head_hash);
    expect(revealedHtml).toContain(mockPassport.server_public_key);
    expect(revealedHtml).toContain(mockPassport.sig);
    expect(revealedHtml).toContain('not verified client-side');
    expect(revealedHtml).not.toContain('Cryptographically verified');
  });

  it('loads passport via api.getPassport(id) and classifies success, not-found, and error states', async () => {
    const spy = vi.spyOn(api, 'getPassport');

    spy.mockResolvedValueOnce(mockPassport);
    const okState = await loadPassportById(mockPassport.observation_id);
    expect(spy).toHaveBeenCalledWith(mockPassport.observation_id);
    expect(okState).toEqual({ kind: 'ready', passport: mockPassport });

    spy.mockRejectedValueOnce(new ApiError('Passport not found', 'NOT_FOUND'));
    const missingState = await loadPassportById(mockPassport.observation_id);
    expect(missingState).toEqual({ kind: 'not_found', message: 'Passport not found' });

    spy.mockRejectedValueOnce(new ApiError('Server unavailable', 'INTERNAL'));
    const errState = await loadPassportById(mockPassport.observation_id);
    expect(errState).toEqual({ kind: 'error', message: 'Server unavailable' });
  });
});
