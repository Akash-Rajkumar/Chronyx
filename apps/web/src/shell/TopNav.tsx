import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {
  useAnchors,
  useConnectionStatus,
  useNetworkHealth,
} from '../state/useDashboardStore.js';

export interface TopNavProps {
  showPassport?: boolean;
  onOpenQrModal?: () => void;
}

const NAV_ITEMS: ReadonlyArray<{ to: string; label: string; isPassport?: boolean }> = [
  { to: '/compare', label: 'Before vs After' },
  { to: '/redteam', label: 'Red-Team Console' },
  { to: '/science', label: 'Science Impact' },
  { to: '/scoreboard', label: 'Scoreboard' },
  { to: '/incidents', label: 'Incidents' },
  { to: '/passport', label: 'Timing Passport', isPassport: true },
];

export const TopNav: React.FC<TopNavProps> = ({
  showPassport = true,
  onOpenQrModal,
}) => {
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const connectionStatus = useConnectionStatus();
  const anchors = useAnchors();
  const network = useNetworkHealth();

  const isOnGlobe =
    location.pathname === '/overview' || location.pathname === '/observatory';

  const isConnected = connectionStatus === 'connected';
  const isConnecting = connectionStatus === 'connecting';
  const isMock = connectionStatus === 'mock';

  const anchorsOk =
    network?.anchor_ok ?? (anchors.length > 0 ? anchors.every((a) => a.ok) : false);

  const visibleItems = NAV_ITEMS.filter((item) => !item.isPassport || showPassport);

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all duration-200 ${
      isActive
        ? 'bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/40 shadow-[0_0_16px_rgba(61,214,245,0.2)]'
        : 'text-white/75 hover:text-white hover:bg-white/5 border border-transparent'
    }`;

  return (
    <header className="fixed top-0 left-0 right-0 z-30 px-3 sm:px-5 pt-3 pointer-events-none">
      <div className="pointer-events-auto liquid-glass rounded-full max-w-6xl mx-auto px-3 sm:px-4 py-1.5 flex items-center justify-between gap-2 bg-[#060913]/75 shadow-[0_8px_32px_rgba(0,0,0,0.45)]">
        {/* Left: Brand / Back to Observatory Globe */}
        <div className="flex items-center gap-2.5 shrink-0">
          <NavLink
            to="/overview"
            onClick={() => setMobileOpen(false)}
            className={`flex items-center gap-2 px-2 py-1 rounded-full transition-colors ${
              isOnGlobe
                ? 'text-white'
                : 'text-white/85 hover:text-accent-cyan'
            }`}
            title="Global Observatory Globe"
          >
            <span className="h-7 w-7 rounded-full bg-accent-cyan/15 border border-accent-cyan/40 flex items-center justify-center text-accent-cyan font-bold text-xs">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="w-4 h-4"
                aria-hidden="true"
              >
                <path
                  d="M4.21 16.5 A9 9 0 0 1 16.5 4.21"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
                <path
                  d="M16.5 4.21 A9 9 0 0 1 19.79 16.5"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeDasharray="2.4 2.3"
                />
                <circle cx="12" cy="12" r="2.5" fill="currentColor" />
              </svg>
            </span>
            <span className="font-semibold text-sm tracking-tight text-white">
              Chronyx
            </span>
          </NavLink>

          {!isOnGlobe && (
            <NavLink
              to="/overview"
              className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-mono text-accent-cyan bg-accent-cyan/10 border border-accent-cyan/30 hover:bg-accent-cyan/20 transition-colors"
            >
              <span>Globe</span>
            </NavLink>
          )}
        </div>

        {/* Center: Exact 6 Required Navigation Destinations */}
        <nav
          aria-label="Primary observatory navigation"
          className="hidden lg:flex items-center gap-1"
        >
          {visibleItems.map((item) => (
            <NavLink key={item.to} to={item.to} className={navLinkClass}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Right: Live Status Indicators + Optional QR Trigger on Subpages + Mobile Menu */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Compact Live Connection & NTP Anchor Status */}
          <div className="hidden sm:flex items-center gap-2 px-2.5 py-1 rounded-full bg-black/40 border border-white/10 text-[11px] font-mono">
            <span
              className={`h-2 w-2 rounded-full ${
                isConnected
                  ? 'bg-emerald-400 shadow-[0_0_6px_#34d399]'
                  : isMock
                    ? 'bg-accent-cyan'
                    : isConnecting
                      ? 'bg-amber-400 animate-pulse'
                      : 'bg-red-400'
              }`}
              title={`Gateway: ${connectionStatus}`}
            />
            <span className="text-white/75 hidden xl:inline">
              {isConnected ? 'Live' : isMock ? 'Mock' : isConnecting ? 'Sync' : 'Offline'}
            </span>
            <span className="text-white/20 hidden xl:inline">|</span>
            <span
              className={`text-[10px] ${
                anchorsOk ? 'text-emerald-300' : 'text-amber-300'
              }`}
              title={anchorsOk ? 'External NTP Anchors Synchronized' : 'External NTP Anchors Unavailable'}
            >
              {anchorsOk ? 'Anchors OK' : 'Anchors'}
            </span>
          </div>

          {!isOnGlobe && onOpenQrModal && (
            <button
              type="button"
              onClick={onOpenQrModal}
              className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/35 hover:bg-accent-cyan/25 transition-colors cursor-pointer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z" />
              </svg>
              <span>Join Node</span>
            </button>
          )}

          {/* Mobile / Tablet Menu Button */}
          <button
            type="button"
            onClick={() => setMobileOpen((prev) => !prev)}
            aria-label="Toggle navigation menu"
            aria-expanded={mobileOpen}
            className="lg:hidden h-8 w-8 rounded-full flex items-center justify-center text-white/85 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          >
            {mobileOpen ? (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Compact Mobile / Tablet Dropdown Menu */}
      {mobileOpen && (
        <div className="pointer-events-auto lg:hidden mt-2 max-w-6xl mx-auto rounded-2xl liquid-glass bg-[#080d1a]/92 p-3 shadow-2xl">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            <NavLink
              to="/overview"
              onClick={() => setMobileOpen(false)}
              className={navLinkClass}
            >
              Global Observatory
            </NavLink>
            {visibleItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                onClick={() => setMobileOpen(false)}
                className={navLinkClass}
              >
                {item.label}
              </NavLink>
            ))}
          </div>
          {onOpenQrModal && (
            <div className="mt-2 pt-2 border-t border-white/10 flex items-center justify-between">
              <span className="text-[11px] font-mono text-white/60">
                {anchorsOk ? 'NTP Anchors OK' : 'NTP Anchors Unavailable'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setMobileOpen(false);
                  onOpenQrModal();
                }}
                className="px-3 py-1 rounded-full text-xs font-medium bg-accent-cyan/15 text-accent-cyan border border-accent-cyan/35"
              >
                Join as a Node (QR)
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
};
