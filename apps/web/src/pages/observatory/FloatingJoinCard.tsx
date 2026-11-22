import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { useQrModalStore, openQrModal } from '../../state/useQrModalStore.js';
import { useConnectionStatus } from '../../state/useDashboardStore.js';

/**
 * Compact floating Liquid Glass "Join as a Node" card positioned in the upper-right
 * of the Global Observatory page. Reuses the existing useQrModalStore, api.getJoinInfo(),
 * QRCodeSVG, and JoinQrModal without duplicating QR logic or backend calls.
 */
export const FloatingJoinCard: React.FC = () => {
  const { data, isLoading, error, fetchJoinInfo } = useQrModalStore();
  const connectionStatus = useConnectionStatus();
  const [expanded, setExpanded] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Load real join credentials when the card is expanded (or once if not already cached)
  useEffect(() => {
    if (expanded && !data && !isLoading && !error) {
      void fetchJoinInfo();
    }
  }, [expanded, data, isLoading, error, fetchJoinInfo]);

  const handleCopy = async () => {
    if (!data?.join_url) return;
    try {
      await navigator.clipboard.writeText(data.join_url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API unavailable
    }
  };

  const isLive = connectionStatus === 'connected';

  return (
    <aside
      data-testid="floating-join-window"
      aria-label="Join as a Timing Node"
      className="fixed top-20 right-3 sm:right-5 z-20 w-[236px] sm:w-[264px]"
    >
      <div className="liquid-glass rounded-2xl bg-[#070b15]/82 p-3.5 text-white shadow-[0_12px_36px_rgba(0,0,0,0.5)]">
        {/* Header Row */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className={`h-2 w-2 rounded-full shrink-0 ${
                isLive ? 'bg-accent-cyan shadow-[0_0_8px_#3dd6f5]' : 'bg-amber-400'
              }`}
            />
            <span className="text-[11px] font-mono font-semibold uppercase tracking-[0.14em] text-white/90 truncate">
              JOIN AS A NODE
            </span>
          </div>

          <button
            type="button"
            onClick={() => setExpanded((prev) => !prev)}
            className="text-[11px] font-mono text-accent-cyan hover:text-white transition-colors px-1.5 py-0.5 rounded-md hover:bg-white/10 cursor-pointer shrink-0"
            aria-expanded={expanded}
          >
            {expanded ? 'Hide QR' : 'Show QR'}
          </button>
        </div>

        {/* Compact Action Bar (Always visible) */}
        {!expanded && (
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/40 hover:bg-accent-cyan/25 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              <span>Scan QR</span>
            </button>
            <Link
              to="/join"
              className="px-3 py-1.5 rounded-full text-xs font-medium bg-white/10 hover:bg-white/20 text-white border border-white/15 transition-colors whitespace-nowrap"
            >
              Join
            </Link>
          </div>
        )}

        {/* Expanded Live QR Section */}
        {expanded && (
          <div className="mt-3 space-y-2.5">
            <p className="text-[11px] text-white/65 leading-snug">
              Scan with a phone or laptop on the same LAN to register a live browser timing node.
            </p>

            {isLoading && !data && (
              <div className="py-6 flex flex-col items-center justify-center gap-2 text-center">
                <div className="w-6 h-6 rounded-full border-2 border-accent-cyan/30 border-t-accent-cyan animate-spin" />
                <span className="text-[11px] font-mono text-white/60">Loading credentials…</span>
              </div>
            )}

            {!isLoading && error && !data && (
              <div className="p-2.5 rounded-xl bg-red-950/60 border border-red-500/40 text-center space-y-2">
                <p className="text-[11px] text-red-200">{error}</p>
                <button
                  type="button"
                  onClick={() => void fetchJoinInfo()}
                  className="px-3 py-1 rounded-full text-[11px] font-medium bg-white/10 hover:bg-white/20 text-white cursor-pointer"
                >
                  Retry
                </button>
              </div>
            )}

            {data && (
              <>
                <div className="bg-white p-2.5 rounded-xl flex items-center justify-center mx-auto w-fit shadow-inner">
                  <QRCodeSVG
                    value={data.join_url}
                    size={148}
                    level="M"
                    includeMargin={false}
                    bgColor="#FFFFFF"
                    fgColor="#06080D"
                  />
                </div>

                <div className="flex items-center gap-1.5 bg-black/50 border border-white/10 rounded-lg px-2 py-1">
                  <span
                    className="text-[10px] font-mono text-accent-cyan truncate flex-1 select-all"
                    title={data.join_url}
                  >
                    {data.join_url}
                  </span>
                  <button
                    type="button"
                    onClick={() => void handleCopy()}
                    className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-white cursor-pointer shrink-0"
                  >
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={openQrModal}
                className="flex-1 px-2.5 py-1.5 rounded-full text-[11px] font-medium bg-white/10 hover:bg-white/15 text-white border border-white/15 transition-colors cursor-pointer"
              >
                Full Modal
              </button>
              <Link
                to="/join"
                className="flex-1 text-center px-2.5 py-1.5 rounded-full text-[11px] font-semibold bg-white text-black hover:bg-white/90 transition-colors"
              >
                Join Here →
              </Link>
            </div>
          </div>
        )}
      </div>
    </aside>
  );
};
