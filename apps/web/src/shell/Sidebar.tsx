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
}

export const Sidebar: React.FC<SidebarProps> = ({
  className = '',
  showPassport = false, // Hidden until implemented (Phase 3 & Correction 2)
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
        <div className="flex items-center gap-3 px-2">
          <div className="h-8 w-8 rounded-lg bg-accent-cyan/10 border border-accent-cyan/30 flex items-center justify-center font-bold text-accent-cyan">
            C
          </div>
          <div>
            <h1 className="font-semibold text-base tracking-tight text-foreground">Chronyx</h1>
            <p className="text-xs text-muted">Timing Verification</p>
          </div>
        </div>

        <nav className="flex flex-col gap-1">
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
