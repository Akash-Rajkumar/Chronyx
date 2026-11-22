import React from 'react';
import { NavLink } from 'react-router-dom';
import { CONTRACT_VERSION } from '@chronyx/contracts';
import {
  useConnectionStatus,
  useAnchors,
  useNetworkHealth,
} from '../state/useDashboardStore.js';
import { useQrModalStore } from '../state/useQrModalStore.js';

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
  const storeOpenQrModal = useQrModalStore((s) => s.openQrModal);
  const handleOpenQr = onOpenQrModal ?? storeOpenQrModal;
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
    `px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
      isActive
        ? 'bg-card text-accent-cyan border border-border shadow-sm'
        : 'text-muted hover:text-foreground hover:bg-card/50'
    }`;

  return (
    <aside
      className={`w-64 border-r border-border bg-card/40 flex flex-col justify-between p-4 shrink-0 h-full ${className}`}
    >
      <div className="space-y-6">
        <NavLink to="/" title="Chronyx Landing Page" className="flex items-center gap-3 px-2 group hover:opacity-90 transition-opacity">
          <div className="h-8 w-8 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30 flex items-center justify-center font-bold text-accent-cyan group-hover:scale-105 transition-transform">
            C
          </div>
          <div>
            <h1 className="font-semibold text-base tracking-tight text-foreground">Chronyx</h1>
            <p className="text-xs text-muted">Timing Verification</p>
          </div>
        </NavLink>

        <nav className="flex flex-col gap-1">
          <NavLink to="/overview" end className={navLinkClass}>
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
        </nav>
      </div>

      <div className="space-y-3 pt-4 border-t border-border/60">
        <NavLink
          to="/join"
          data-testid="join-button"
          className="w-full py-2 px-3 rounded-lg bg-accent-cyan/10 hover:bg-accent-cyan/20 border border-accent-cyan/40 text-accent-cyan text-sm font-medium flex items-center justify-center transition-colors"
        >
          Join as a Node
        </NavLink>

        <button
          type="button"
          onClick={handleOpenQr}
          data-testid="sidebar-qr-button"
          className="w-full py-1.5 px-3 rounded-lg border border-border bg-card/60 hover:bg-card hover:border-accent-cyan/30 text-muted hover:text-foreground text-xs font-medium flex items-center justify-center gap-1.5 transition-colors focus:outline-none focus:ring-2 focus:ring-accent-cyan/50"
        >
          <svg className="w-3.5 h-3.5 text-accent-cyan" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
          </svg>
          Scan QR to Join
        </button>

        <div className="text-xs text-muted/70 flex flex-col gap-1 px-1">
          <div className="flex items-center justify-between">
            <span>Contract</span>
            <span className="font-mono text-[11px] text-muted">v{CONTRACT_VERSION}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Socket</span>
            <span
              className={`flex items-center gap-1 font-mono text-[11px] ${
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
                    ? 'bg-trust-trusted'
                    : isConnecting
                    ? 'bg-trust-suspect animate-pulse'
                    : 'bg-trust-quarantined'
                }`}
              />
              {isMock ? 'Mock (Simulated)' : isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span>Anchors</span>
            <span
              className={`flex items-center gap-1 font-mono text-[11px] ${
                anchorsOk ? 'text-muted' : 'text-trust-quarantined'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${
                  anchorsOk ? 'bg-muted' : 'bg-trust-quarantined'
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
