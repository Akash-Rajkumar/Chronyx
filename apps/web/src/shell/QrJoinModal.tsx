import React, { useCallback, useEffect, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '../api/client.js';
import { Button } from '../ui/Button.js';
import { Skeleton } from '../ui/Skeleton.js';

export interface QrJoinModalProps {
  open: boolean;
  onClose: () => void;
}

function getFallbackJoinUrl(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return `${window.location.origin}/join`;
  }
  return '/join';
}

/**
 * Mission Control QR Join Modal
 * Fetches server LAN join details via `api.getJoinInfo()` and renders a scannable QR code
 * for audience phones/devices to join as browser clock nodes.
 */
export const QrJoinModal: React.FC<QrJoinModalProps> = ({ open, onClose }) => {
  const [joinUrl, setJoinUrl] = useState<string>(getFallbackJoinUrl);
  const [wsUrl, setWsUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadJoinInfo = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const info = await api.getJoinInfo();
      setJoinUrl(info.join_url || getFallbackJoinUrl());
      setWsUrl(info.ws_url || null);
    } catch (err) {
      setJoinUrl(getFallbackJoinUrl());
      setWsUrl(null);
      setError(err instanceof Error ? err.message : 'Unable to reach server join metadata');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      return;
    }
    void loadJoinInfo();
  }, [open, loadJoinInfo]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  const handleCopy = async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(joinUrl);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      setCopied(false);
    }
  };

  if (!open) return null;

  return (
    <div
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#030712]/80 backdrop-blur-md"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="qr-join-modal-title"
        data-testid="qr-join-modal"
        className="mc-panel-primary mc-ticks w-full max-w-md rounded-[14px] p-5 sm:p-6 space-y-5 shadow-[0_28px_70px_rgba(2,6,18,0.85)]"
      >
        <div className="flex items-start justify-between gap-3 pb-3 border-b border-white/[0.08]">
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.14em] text-accent-cyan/90">
              <span className="mc-live-dot h-1.5 w-1.5 rounded-full bg-accent-cyan" aria-hidden="true" />
              <span>Field Enrollment</span>
            </div>
            <h2
              id="qr-join-modal-title"
              className="text-lg font-semibold tracking-tight text-foreground"
            >
              Join Observatory Network
            </h2>
            <p className="text-xs text-muted">
              Scan on any phone or open the join link to attach a software-only browser clock node.
            </p>
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Close Join QR dialog"
            onClick={onClose}
            className="shrink-0"
          >
            Close
          </Button>
        </div>

        <div className="flex flex-col items-center justify-center py-2">
          {loading ? (
            <div className="w-[220px] h-[220px] rounded-[12px] mc-well flex items-center justify-center p-4">
              <Skeleton width={188} height={188} />
            </div>
          ) : (
            <div className="bg-white p-3.5 rounded-[12px] inline-flex items-center justify-center shadow-[0_12px_32px_rgba(2,6,18,0.55)] ring-1 ring-white/25">
              <QRCodeSVG
                value={joinUrl}
                size={192}
                bgColor="#FFFFFF"
                fgColor="#060B18"
                level="M"
              />
            </div>
          )}
        </div>

        <div className="mc-well p-3.5 rounded-[10px] space-y-2.5">
          <div className="flex items-center justify-between gap-2 text-[10px] font-mono uppercase tracking-[0.1em] text-muted">
            <span>Join Endpoint</span>
            {error && (
              <button
                type="button"
                onClick={() => void loadJoinInfo()}
                className="text-accent-cyan hover:underline font-semibold normal-case tracking-normal"
              >
                Retry server lookup
              </button>
            )}
          </div>
          <div className="flex items-center gap-2">
            <code className="flex-1 min-w-0 truncate text-xs font-mono text-accent-cyan bg-[#040914]/80 border border-white/[0.08] px-2.5 py-2 rounded-[8px]">
              {joinUrl}
            </code>
            <Button variant="secondary" size="sm" onClick={() => void handleCopy()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          {wsUrl && (
            <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-muted">
              <span>Telemetry stream</span>
              <span className="truncate text-foreground/85">{wsUrl}</span>
            </div>
          )}
          {error && (
            <p className="text-[11px] text-trust-suspect">
              Server lookup fallback active ({error}). Using current origin link.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 pt-1 text-xs text-muted">
          <span>Software-only browser clock agent</span>
          <a
            href={joinUrl}
            target="_blank"
            rel="noreferrer"
            className="text-accent-cyan font-medium hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 rounded"
          >
            Open /join →
          </a>
        </div>
      </div>
    </div>
  );
};
