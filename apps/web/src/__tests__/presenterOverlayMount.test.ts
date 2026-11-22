// TEST-FIXTURE
import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { AppShell } from '../shell/AppShell.js';
import { useQrModalStore } from '../state/useQrModalStore.js';

describe('Presenter Overlay AppShell Mounting (P3 / P4)', () => {
  beforeEach(() => {
    useQrModalStore.getState().reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1. does not render visual presenter bar when present query param is not active', () => {
    const html = renderToString(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        React.createElement(AppShell, null, React.createElement('div', null, 'Content')),
      ),
    );

    expect(html).not.toContain('aria-label="Presenter scenario bar"');
    expect(html).not.toContain('PRESENTER');
    expect(html).toContain('Content');
  });

  it('2. mounts and renders visual presenter bar and demo cue card when ?present=1 is set', () => {
    const html = renderToString(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/?present=1'] },
        React.createElement(AppShell, null, React.createElement('div', null, 'Content')),
      ),
    );

    expect(html).toContain('aria-label="Presenter scenario bar"');
    expect(html).toContain('PRESENTER');
    expect(html).toContain('Presenter demo cue card');
    expect(html).toContain('Content');
  });

  it('3. renders timing passport navigation in sidebar by default', () => {
    const html = renderToString(
      React.createElement(
        MemoryRouter,
        { initialEntries: ['/'] },
        React.createElement(AppShell, null, React.createElement('div', null, 'Content')),
      ),
    );

    expect(html).toContain('Timing Passport');
    expect(html).toContain('href="/passport"');
  });
});
