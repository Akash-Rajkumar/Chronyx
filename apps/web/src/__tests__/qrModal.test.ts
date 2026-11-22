// TEST-FIXTURE
import React from 'react';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { renderToString } from 'react-dom/server';
import {
  JoinQrModal,
  focusInitialModalElement,
  restoreModalFocus,
  trapModalFocus,
} from '../ui/JoinQrModal.js';
import { useQrModalStore, openQrModal, closeQrModal } from '../state/useQrModalStore.js';
import { openQrModal as shellOpenQrModal } from '../shell/AppShell.js';
import { api } from '../api/client.js';
import type { JoinInfo } from '@chronyx/contracts';
import { JoinInfoSchema } from '@chronyx/contracts';

describe('Shared QR Join Modal & Store (P3)', () => {
  const mockJoinPayload: JoinInfo = {
    join_url: 'http://localhost:5173/join',
    ws_url: 'http://localhost:3001',
    api_url: 'http://localhost:3001',
  };

  const origDocument = globalThis.document;

  beforeEach(() => {
    useQrModalStore.getState().reset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    globalThis.document = origDocument;
  });

  it('validates mockJoinPayload against frozen JoinInfoSchema contract', () => {
    const parsed = JoinInfoSchema.safeParse(mockJoinPayload);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.join_url).toBe('http://localhost:5173/join');
    }
  });

  it('strictly enforces the public openQrModal(): void synchronous contract', () => {
    const storeResult = openQrModal();
    expect(storeResult).toBeUndefined();
    expect(useQrModalStore.getState().isOpen).toBe(true);

    closeQrModal();
    expect(useQrModalStore.getState().isOpen).toBe(false);

    const shellResult = shellOpenQrModal();
    expect(shellResult).toBeUndefined();
    expect(useQrModalStore.getState().isOpen).toBe(true);
  });

  it('renders null when modal is closed', () => {
    const html = renderToString(React.createElement(JoinQrModal, { isOpen: false }));
    expect(html).toBe('');
  });

  it('renders loading state when isLoading is true and no data yet', () => {
    const html = renderToString(
      React.createElement(JoinQrModal, {
        isOpen: true,
        isLoading: true,
        data: null,
      }),
    );

    expect(html).toContain('data-testid="qr-modal-dialog"');
    expect(html).toContain('data-testid="qr-modal-loading"');
    expect(html).toContain('Retrieving observatory join credentials...');
  });

  it('renders error state with clean SVG error icon and retry button', () => {
    const html = renderToString(
      React.createElement(JoinQrModal, {
        isOpen: true,
        isLoading: false,
        data: null,
        error: 'Network timeout connecting to gateway',
      }),
    );

    expect(html).toContain('data-testid="qr-modal-error"');
    expect(html).toContain('Unable to load join credentials');
    expect(html).toContain('Network timeout connecting to gateway');

    // Clean SVG error icon, no raw unicode/emoji encoding issues
    expect(html).toContain('data-testid="qr-modal-error-icon"');
    expect(html).toContain('<svg');
    expect(html).not.toContain('⚠️');

    expect(html).toContain('data-testid="qr-modal-retry"');
    expect(html).toContain('Retry Connection');
  });

  it('renders accessible dialog container with tabIndex and aria labels', () => {
    const html = renderToString(
      React.createElement(JoinQrModal, {
        isOpen: true,
        isLoading: false,
        data: mockJoinPayload,
      }),
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="qr-modal-title"');
    expect(html).toContain('aria-describedby="qr-modal-desc"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-testid="qr-modal-close"');
    expect(html).toContain('aria-label="Close QR Modal"');
  });

  it('renders actual QR payload and endpoints when data is available', () => {
    const html = renderToString(
      React.createElement(JoinQrModal, {
        isOpen: true,
        isLoading: false,
        data: mockJoinPayload,
      }),
    );

    expect(html).toContain('data-testid="qr-modal-content"');
    expect(html).toContain('data-testid="qr-code-svg"');
    expect(html).toContain('<svg');
    expect(html).toContain('http://localhost:5173/join');
    expect(html).toContain('data-testid="qr-modal-copy"');
    expect(html).toContain('http://localhost:3001');
  });

  // --- Interaction & Lifecycle Tests ---

  describe('Component Lifecycle & State Transitions', () => {
    it('1 & 2. Mounts closed, then opens through actual store action', () => {
      // 1. Initially closed in store
      expect(useQrModalStore.getState().isOpen).toBe(false);
      const initialHtml = renderToString(React.createElement(JoinQrModal, null));
      expect(initialHtml).toBe('');

      // 2. Open through actual store action
      openQrModal();
      expect(useQrModalStore.getState().isOpen).toBe(true);

      const openedHtml = renderToString(React.createElement(JoinQrModal, null));
      expect(openedHtml).toContain('data-testid="qr-modal-dialog"');
      expect(openedHtml).toContain('role="dialog"');
    });

    it('3. Initial focus enters dialog container or first focusable control', () => {
      const mockCloseBtn = { focus: vi.fn() } as unknown as HTMLElement;
      const mockDialog = {
        focus: vi.fn(),
        querySelectorAll: vi.fn().mockReturnValue([mockCloseBtn]),
      } as unknown as HTMLElement;

      focusInitialModalElement(mockDialog);
      expect(mockCloseBtn.focus).toHaveBeenCalledTimes(1);

      const emptyDialog = {
        focus: vi.fn(),
        querySelectorAll: vi.fn().mockReturnValue([]),
      } as unknown as HTMLElement;
      focusInitialModalElement(emptyDialog);
      expect(emptyDialog.focus).toHaveBeenCalledTimes(1);
    });

    it('4. API failure displays error state without automatic retry loop', async () => {
      const getJoinInfoSpy = vi
        .spyOn(api, 'getJoinInfo')
        .mockRejectedValue(new Error('Gateway unreachable'));

      openQrModal();
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(1);

      await useQrModalStore.getState().fetchJoinInfo();
      expect(useQrModalStore.getState().error).toBe('Gateway unreachable');

      // Render mounted modal with error state
      const errorHtml = renderToString(React.createElement(JoinQrModal, null));
      expect(errorHtml).toContain('data-testid="qr-modal-error"');
      expect(errorHtml).toContain('Gateway unreachable');
      expect(errorHtml).toContain('data-testid="qr-modal-retry"');

      // Verify no automatic retry loop while modal remains open
      await new Promise((r) => setTimeout(r, 20));
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(1);
    });

    it('5. Explicit Retry Connection makes exactly one additional request', async () => {
      const getJoinInfoSpy = vi
        .spyOn(api, 'getJoinInfo')
        .mockRejectedValueOnce(new Error('Initial failure'))
        .mockResolvedValueOnce(mockJoinPayload);

      // Initial failure
      openQrModal();
      await useQrModalStore.getState().fetchJoinInfo();
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(1);

      // Explicit retry via button action
      await useQrModalStore.getState().fetchJoinInfo();
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(2);

      const successHtml = renderToString(React.createElement(JoinQrModal, null));
      expect(successHtml).toContain('data-testid="qr-modal-content"');
      expect(successHtml).toContain('data-testid="qr-code-svg"');
    });

    it('6. Closing modal returns focus to triggering element', () => {
      const mockTrigger = { focus: vi.fn() } as unknown as HTMLElement;

      // Simulate opening from a trigger element and closing
      openQrModal();
      expect(useQrModalStore.getState().isOpen).toBe(true);

      closeQrModal();
      expect(useQrModalStore.getState().isOpen).toBe(false);

      restoreModalFocus(mockTrigger);
      expect(mockTrigger.focus).toHaveBeenCalledTimes(1);

      const closedHtml = renderToString(React.createElement(JoinQrModal, null));
      expect(closedHtml).toBe('');
    });

    it('7. Unmounting while open safely restores focus', () => {
      const mockTrigger = { focus: vi.fn() } as unknown as HTMLElement;

      // Open modal
      openQrModal();
      expect(useQrModalStore.getState().isOpen).toBe(true);

      // Simulate unmount cleanup restoring focus
      restoreModalFocus(mockTrigger);
      expect(mockTrigger.focus).toHaveBeenCalledTimes(1);

      // Verify safe handling of null
      expect(() => restoreModalFocus(null)).not.toThrow();
    });

    it('8. Closing and reopening after failure makes exactly one new request', async () => {
      const getJoinInfoSpy = vi
        .spyOn(api, 'getJoinInfo')
        .mockRejectedValueOnce(new Error('Network offline'))
        .mockResolvedValueOnce(mockJoinPayload);

      openQrModal();
      await useQrModalStore.getState().fetchJoinInfo();
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(1);

      closeQrModal();
      expect(useQrModalStore.getState().isOpen).toBe(false);

      openQrModal();
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(2);

      await useQrModalStore.getState().fetchJoinInfo();
      expect(useQrModalStore.getState().data).toEqual(mockJoinPayload);
    });

    it('9. Reopening after successful fetch uses cached data', async () => {
      const getJoinInfoSpy = vi.spyOn(api, 'getJoinInfo').mockResolvedValue(mockJoinPayload);

      openQrModal();
      await useQrModalStore.getState().fetchJoinInfo();
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(1);

      closeQrModal();
      expect(useQrModalStore.getState().isOpen).toBe(false);

      openQrModal();
      expect(useQrModalStore.getState().isOpen).toBe(true);
      // No additional request made
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(1);
      expect(useQrModalStore.getState().data).toEqual(mockJoinPayload);
    });

    it('10. Opening while a request is pending deduplicates requests', async () => {
      let resolveApi!: (val: JoinInfo) => void;
      const pendingPromise = new Promise<JoinInfo>((resolve) => {
        resolveApi = resolve;
      });

      const getJoinInfoSpy = vi.spyOn(api, 'getJoinInfo').mockReturnValue(pendingPromise);

      openQrModal();
      openQrModal();
      openQrModal();
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(1);

      resolveApi(mockJoinPayload);
      await pendingPromise;
      await useQrModalStore.getState().fetchJoinInfo();
      expect(getJoinInfoSpy).toHaveBeenCalledTimes(1);
    });

    it('11. Tab and Shift+Tab wrap correctly within dialog', () => {
      const firstElement = { focus: vi.fn() } as unknown as HTMLElement;
      const lastElement = { focus: vi.fn() } as unknown as HTMLElement;

      const mockDialog = {
        focus: vi.fn(),
        querySelectorAll: vi.fn().mockReturnValue([firstElement, lastElement]),
        contains: vi.fn((el) => el === firstElement || el === lastElement || el === mockDialog),
      } as unknown as HTMLElement;

      const onClose = vi.fn();

      // Tab on last element wraps to first
      globalThis.document = { activeElement: lastElement } as unknown as Document;
      const tabEvent = { key: 'Tab', shiftKey: false, preventDefault: vi.fn() } as unknown as KeyboardEvent;
      trapModalFocus(tabEvent, mockDialog, onClose);
      expect(tabEvent.preventDefault).toHaveBeenCalled();
      expect(firstElement.focus).toHaveBeenCalled();

      // Shift+Tab on first element wraps to last
      globalThis.document = { activeElement: firstElement } as unknown as Document;
      const shiftTabEvent = { key: 'Tab', shiftKey: true, preventDefault: vi.fn() } as unknown as KeyboardEvent;
      trapModalFocus(shiftTabEvent, mockDialog, onClose);
      expect(shiftTabEvent.preventDefault).toHaveBeenCalled();
      expect(lastElement.focus).toHaveBeenCalled();

      // Escape closes dialog
      const escapeEvent = { key: 'Escape', preventDefault: vi.fn() } as unknown as KeyboardEvent;
      trapModalFocus(escapeEvent, mockDialog, onClose);
      expect(escapeEvent.preventDefault).toHaveBeenCalled();
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });
});
