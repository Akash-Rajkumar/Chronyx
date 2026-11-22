import React, { useEffect, useState, useRef } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import type { JoinInfo } from '@chronyx/contracts';
import { useQrModalStore } from '../state/useQrModalStore.js';
import { Button } from './Button.js';

export interface JoinQrModalProps {
  isOpen?: boolean;
  onClose?: () => void;
  data?: JoinInfo | null;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

/**
 * Focuses the first accessible interactive element inside the modal dialog,
 * or falls back to focusing the dialog container itself.
 */
export function focusInitialModalElement(dialog: HTMLElement | null): void {
  if (!dialog) return;
  const focusable = dialog.querySelectorAll<HTMLElement>(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  if (focusable.length > 0 && focusable[0]) {
    focusable[0].focus();
  } else {
    dialog.focus();
  }
}

/**
 * Restores focus to the triggering element safely if available.
 */
export function restoreModalFocus(element: HTMLElement | null): void {
  if (element && typeof element.focus === 'function') {
    element.focus();
  }
}

/**
 * Keyboard focus-trap and Escape-key handler for modal dialogs.
 * - Escape closes the dialog.
 * - Tab from the last focusable element wraps to the first.
 * - Shift+Tab from the first wraps to the last.
 * - If focus is on the dialog container or outside, Tab/Shift+Tab brings focus inside.
 */
export function trapModalFocus(
  e: KeyboardEvent,
  dialog: HTMLElement | null,
  onClose: () => void,
): void {
  if (e.key === 'Escape') {
    e.preventDefault();
    onClose();
    return;
  }

  if (e.key === 'Tab') {
    if (!dialog) return;
    const focusable = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );

    if (focusable.length === 0) {
      e.preventDefault();
      dialog.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const currentActive = typeof document !== 'undefined' ? document.activeElement : null;
    const isInside = currentActive ? dialog.contains(currentActive) : false;
    const isContainer = currentActive === dialog;

    if (e.shiftKey) {
      if (!isInside || isContainer || currentActive === first) {
        e.preventDefault();
        last?.focus();
      }
    } else {
      if (!isInside || isContainer || currentActive === last) {
        e.preventDefault();
        first?.focus();
      }
    }
  }
}

export const JoinQrModal: React.FC<JoinQrModalProps> = ({
  isOpen: propIsOpen,
  onClose: propOnClose,
  data: propData,
  isLoading: propIsLoading,
  error: propError,
  onRetry: propOnRetry,
}) => {
  const storeState = useQrModalStore();
  const store = typeof window === 'undefined' ? useQrModalStore.getState() : storeState;

  const isOpen = propIsOpen !== undefined ? propIsOpen : store.isOpen;
  const onClose = propOnClose ?? store.closeQrModal;
  const data = propData !== undefined ? propData : store.data;
  const isLoading = propIsLoading !== undefined ? propIsLoading : store.isLoading;
  const error = propError !== undefined ? propError : store.error;
  const onRetry = propOnRetry ?? store.fetchJoinInfo;

  const [copied, setCopied] = useState(false);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const prevIsOpenRef = useRef(false);

  // Auto-fetch ONLY on initial transition to open.
  // Avoids automatic retry loops on failure while the modal remains open.
  useEffect(() => {
    const justOpened = isOpen && !prevIsOpenRef.current;
    prevIsOpenRef.current = isOpen;

    if (justOpened && !data && !isLoading && propData === undefined) {
      void store.fetchJoinInfo();
    }
  }, [isOpen, data, isLoading, propData, store]);

  // Focus management: record triggering element on open, restore on close
  useEffect(() => {
    if (typeof document === 'undefined') return;

    if (isOpen) {
      previousActiveElementRef.current = document.activeElement as HTMLElement | null;
    } else {
      restoreModalFocus(previousActiveElementRef.current);
      previousActiveElementRef.current = null;
    }
  }, [isOpen]);

  // Focus into dialog when opened
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const timer = setTimeout(() => {
      focusInitialModalElement(dialogRef.current);
    }, 0);

    return () => {
      clearTimeout(timer);
    };
  }, [isOpen]);

  // Cleanup: restore focus on unmount if modal was open
  useEffect(() => {
    return () => {
      restoreModalFocus(previousActiveElementRef.current);
      previousActiveElementRef.current = null;
    };
  }, []);

  // Keyboard accessibility: Escape key closes modal; Tab and Shift+Tab trapped inside dialog
  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      trapModalFocus(e, dialogRef.current, onClose);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const handleCopy = async () => {
    if (!data?.join_url) return;
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(data.join_url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Fallback or ignore clipboard permission error
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div
      role="presentation"
      data-testid="qr-modal-backdrop"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-modal-title"
        aria-describedby="qr-modal-desc"
        tabIndex={-1}
        data-testid="qr-modal-dialog"
        className="relative w-full max-w-md bg-card border border-border rounded-2xl shadow-2xl p-6 space-y-5 text-foreground outline-none"
      >
        {/* Close Button */}
        <button
          type="button"
          onClick={onClose}
          data-testid="qr-modal-close"
          aria-label="Close QR Modal"
          className="absolute top-4 right-4 text-muted hover:text-foreground rounded-lg p-1.5 hover:bg-background/60 transition-colors focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Header */}
        <div className="space-y-1">
          <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded bg-accent-cyan/15 border border-accent-cyan/40 text-accent-cyan font-mono text-[11px] font-semibold">
            NODE REGISTRATION
          </div>
          <h3 id="qr-modal-title" className="text-lg font-semibold text-foreground tracking-tight">
            Join as a Timing Node
          </h3>
          <p id="qr-modal-desc" className="text-xs text-muted leading-relaxed">
            Scan this QR code with a phone or secondary device camera to launch a browser node and begin timing verification.
          </p>
        </div>

        {/* Content States */}
        {isLoading && !data && (
          <div
            data-testid="qr-modal-loading"
            className="flex flex-col items-center justify-center py-10 space-y-3"
          >
            <span className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-accent-cyan border-t-transparent" />
            <p className="text-xs text-muted">Retrieving observatory join credentials...</p>
          </div>
        )}

        {error && !data && (
          <div
            data-testid="qr-modal-error"
            className="p-4 rounded-xl bg-trust-quarantined/10 border border-trust-quarantined/30 text-trust-quarantined space-y-3"
          >
            <div className="flex items-start gap-2.5">
              <svg
                data-testid="qr-modal-error-icon"
                className="w-5 h-5 shrink-0 text-trust-quarantined"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
              <div className="text-xs space-y-1">
                <p className="font-semibold">Unable to load join credentials</p>
                <p className="text-muted text-[11px] font-mono break-words">{error}</p>
              </div>
            </div>
            <div className="flex justify-end pt-1">
              <Button
                variant="secondary"
                size="sm"
                onClick={onRetry}
                data-testid="qr-modal-retry"
              >
                Retry Connection
              </Button>
            </div>
          </div>
        )}

        {data && (
          <div data-testid="qr-modal-content" className="space-y-4">
            {/* QR Code Container with High-Contrast White Background */}
            <div className="flex justify-center">
              <div className="bg-white p-4 rounded-xl shadow-lg border border-white/20 inline-block">
                <QRCodeSVG
                  value={data.join_url}
                  size={192}
                  level="M"
                  includeMargin={false}
                  data-testid="qr-code-svg"
                />
              </div>
            </div>

            {/* Direct Join Link & Copy Button */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted block">Direct Join Link</label>
              <div className="flex items-center gap-2 bg-background/80 border border-border rounded-lg px-3 py-2 text-xs font-mono text-muted">
                <span className="truncate flex-1 text-foreground selection:bg-accent-cyan/20" title={data.join_url}>
                  {data.join_url}
                </span>
                <button
                  type="button"
                  onClick={() => void handleCopy()}
                  data-testid="qr-modal-copy"
                  className="text-accent-cyan hover:underline shrink-0 text-xs font-sans font-medium px-1.5 py-0.5 rounded hover:bg-accent-cyan/10 transition-colors"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Gateway Metadata */}
            <div className="grid grid-cols-2 gap-2 text-[11px] font-mono text-muted bg-background/40 border border-border/60 rounded-lg p-2.5">
              <div className="overflow-hidden">
                <span className="text-muted/60 block text-[10px]">API ENDPOINT</span>
                <span className="truncate block text-foreground" title={data.api_url}>
                  {data.api_url}
                </span>
              </div>
              <div className="overflow-hidden">
                <span className="text-muted/60 block text-[10px]">WEBSOCKET</span>
                <span className="truncate block text-foreground" title={data.ws_url}>
                  {data.ws_url}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Footer info */}
        <div className="pt-2 border-t border-border/60 flex items-center justify-between text-xs text-muted">
          <span>Browser clock sync</span>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground hover:underline text-xs"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
