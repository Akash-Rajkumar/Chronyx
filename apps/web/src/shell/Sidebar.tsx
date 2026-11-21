import React from 'react';
import { NavLink } from 'react-router-dom';
import { CONTRACT_VERSION } from '@chronyx/contracts';
import {
  useConnectionStatus,
  useAnchors,
  useNetworkHealth,
} from '../state/useDashboardStore.js';

export interface SidebarProps {
  className?: string;
  showPassport?: boolean;
  onOpenQrModal?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
  showPassport = false, // Hidden until implemented (Phase 3 & Correction 2)
  onOpenQrModal,
}) => {
  const connectionStatus = useConnectionStatus();
  const anchors = useAnchors();
  const network = useNetworkHealth();

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';
  const isMock = connectionStatus === 'mock';

  // Anchor status calculation
  const anchorsOk =
    network?.anchor_ok ?? (anchors.length > 0 ? anchors.every((a) => a.ok) : true);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center px-3 py-2 rounded-[10px] text-sm font-medium border border-l-2 transition-[background-color,border-color,color] duration-[180ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60 ${
      isActive
        ? 'bg-white/[0.07] border-white/[0.13] border-l-accent-cyan text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
        : 'border-transparent border-l-transparent text-muted hover:text-foreground hover:bg-white/[0.04] hover:border-white/[0.07] hover:border-l-white/25'
    }`;

  return (
    <aside
      className={`w-64 shrink-0 h-full flex flex-col justify-between p-4 border-r border-white/[0.09] bg-[#070D1C]/82 backdrop-blur-xl shadow-[inset_-1px_0_0_rgba(255,255,255,0.04)] ${className}`}
    >
      <div className="space-y-6">
        {/* Observatory Brand Header */}
        <div className="flex items-center gap-3 px-2 pt-1">
          <div className="h-9 w-9 rounded-[10px] bg-white/[0.05] border border-white/[0.14] shadow-[inset_0_1px_0_rgba(255,255,255,0.14)] flex items-center justify-center shrink-0">
            <svg
              width="17"
              height="17"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              className="text-accent-cyan"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 7v5l3.5 2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="font-semibold text-base tracking-tight text-foreground leading-tight">
              Chronyx
            </h1>
            <p className="text-xs text-muted leading-tight mt-0.5">Timing Verification</p>
          </div>
        </div>

        {/* Grouped Navigation */}
        <nav className="space-y-4" aria-label="Main navigation">
          <div className="space-y-1.5">
            <div className="px-3 text-xs font-medium text-muted/75">Operations</div>
            <div className="flex flex-col gap-1">
              <NavLink to="/" end className={navLinkClass}>
                Overview
              </NavLink>
              <NavLink to="/compare" className={navLinkClass}>
                Before vs After
              </NavLink>
              <NavLink to="/redteam" className={navLinkClass}>
                Red-Team Console
              </NavLink>
              <NavLink to="/science" className={navLinkClass}>
                Science Impact
              </NavLink>
            </div>
          </div>

          <div className="pt-3 border-t border-white/[0.07] space-y-1.5">
            <div className="px-3 text-xs font-medium text-muted/75">Evidence</div>
            <div className="flex flex-col gap-1">
              <NavLink to="/scoreboard" className={navLinkClass}>
                Scoreboard
              </NavLink>
              <NavLink to="/incidents" className={navLinkClass}>
                Incidents
              </NavLink>
              {showPassport && (
                <NavLink to="/passport" className={navLinkClass}>
                  Timing Passport
                </NavLink>
              )}
            </div>
          </div>
        </nav>
      </div>

      {/* Bottom Join Action & Technical Status Table */}
      <div className="space-y-3 pt-4 border-t border-white/[0.08]">
        <div className="flex items-center gap-2">
          <NavLink
            to="/join"
            data-testid="join-button"
            className="flex-1 py-2.5 px-3 rounded-[10px] bg-accent-cyan/[0.14] hover:bg-accent-cyan/[0.22] border border-accent-cyan/40 hover:border-accent-cyan/60 text-accent-cyan text-sm font-medium flex items-center justify-center gap-2 transition-[background-color,border-color,transform,box-shadow] duration-[180ms] ease-out shadow-[inset_0_1px_0_rgba(165,243,252,0.28)] hover:-translate-y-[1px] active:translate-y-[0.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
          >
            <svg
              width="15"
              height="15"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              aria-hidden="true"
            >
              <path d="M12 5v14M5 12h14" strokeLinecap="round" />
            </svg>
            <span>Join as a Node</span>
          </NavLink>

          {onOpenQrModal && (
            <button
              type="button"
              onClick={onOpenQrModal}
              title="Show QR join code"
              aria-label="Show QR join code"
              className="py-2.5 px-2.5 rounded-[10px] bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.14] hover:border-accent-cyan/45 text-foreground text-xs font-mono transition-[background-color,border-color] duration-[180ms] ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-cyan/60"
            >
              QR
            </button>
          )}
        </div>

        <div className="mc-well rounded-[10px] divide-y divide-white/[0.06] text-xs">
          <div className="flex items-center justify-between px-3 py-2 text-muted">
            <span>Contract</span>
            <span className="font-mono text-[11px] text-foreground/90">v{CONTRACT_VERSION}</span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-muted">
            <span>Stream</span>
            <span
              className={`flex items-center gap-1.5 font-mono text-[11px] ${
                isMock
                  ? 'text-accent-cyan'
                  : isConnected
                    ? 'text-trust-trusted'
                    : isConnecting
                      ? 'text-trust-suspect'
                      : 'text-trust-quarantined'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  isMock
                    ? 'bg-accent-cyan'
                    : isConnected
                      ? 'bg-trust-trusted mc-live-dot'
                      : isConnecting
                        ? 'bg-trust-suspect mc-live-dot'
                        : 'bg-trust-quarantined'
                }`}
              />
              {isMock
                ? 'Mock (Simulated)'
                : isConnected
                  ? 'Connected'
                  : isConnecting
                    ? 'Connecting'
                    : 'Disconnected'}
            </span>
          </div>
          <div className="flex items-center justify-between px-3 py-2 text-muted">
            <span>Anchors</span>
            <span
              className={`flex items-center gap-1.5 font-mono text-[11px] ${
                anchorsOk ? 'text-foreground/85' : 'text-trust-quarantined'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  anchorsOk ? 'bg-trust-trusted' : 'bg-trust-quarantined'
                }`}
              />
              {anchorsOk ? 'OK' : 'Unavailable'}
            </span>
          </div>
        </div>
      </div>
    </aside>
  );
};
