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

function renderPassportRoute(path: string, initialState?: PassportLoadState): string {
  const pageElement = createElement(PassportPage, initialState ? { initialState } : null);
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

  it('renders contract passport fields accurately without claiming client-side verification', () => {
    useDashboardStore.getState().setSnapshot(JSON.parse(JSON.stringify(mockSnapshot)));
    useDashboardStore.getState().setConnectionStatus('mock');

    const html = renderPassportRoute(`/passport/${mockPassport.observation_id}`, {
      kind: 'ready',
      passport: mockPassport,
    }).replace(/<!-- -->/g, '');

    expect(html).toContain('data-testid="passport-detail"');
    expect(html).toContain('SIMULATED (MOCK)');
    expect(html).toContain(mockPassport.observation_id);
    expect(html).toContain(mockPassport.node_id);
    expect(html).toContain(`href="/nodes/${mockPassport.node_id}"`);
    expect(html).toContain(mockPassport.state_at_observation);
    expect(html).toContain('99%');
    expect(html).toContain('+0.12 ms');
    expect(html).toContain('±0.28 ms');
    expect(html).toContain(mockPassport.evidence_hash);
    expect(html).toContain(mockPassport.chain_head_hash);
    expect(html).toContain(mockPassport.server_public_key);
    expect(html).toContain(mockPassport.sig);
    expect(html).toContain('not verified client-side');
    expect(html).not.toContain('Cryptographically verified');
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
