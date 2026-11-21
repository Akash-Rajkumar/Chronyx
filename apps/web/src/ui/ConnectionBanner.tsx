import React from 'react';
import type { ConnectionStatus } from '../state/useDashboardStore.js';
import { useConnectionStatus } from '../state/useDashboardStore.js';

export interface ConnectionBannerProps {
  status?: ConnectionStatus;
  className?: string;
}

export const ConnectionBanner: React.FC<ConnectionBannerProps> = ({
  status: propStatus,
  className = '',
}) => {
  const storeStatus = useConnectionStatus();
  const status = propStatus ?? storeStatus;

  if (status === 'connected') {
    return null;
  }

  if (status === 'mock') {
    return (
      <div
        data-testid="connection-banner"
        role="status"
        className={`w-full py-2 px-6 bg-accent-cyan/[0.08] backdrop-blur-md border-b border-accent-cyan/25 text-accent-cyan text-xs flex items-center justify-between transition-colors duration-[180ms] ease-out ${className}`}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-accent-cyan" />
          <span className="font-medium">
            Mock Mode Active: Displaying simulated telemetry from frozen contract fixtures.
          </span>
        </div>
        <span className="font-mono text-[11px] opacity-85">VITE_USE_MOCKS=1</span>
      </div>
    );
  }

  const isConnecting = status === 'connecting';

  return (
    <div
      data-testid="connection-banner"
      role="status"
      className={`w-full py-2 px-6 bg-amber-500/[0.09] backdrop-blur-md border-b border-amber-400/25 text-trust-suspect text-xs flex items-center justify-between transition-colors duration-[180ms] ease-out ${className}`}
    >
      <div className="flex items-center gap-2">
        <span
          className={`inline-block h-1.5 w-1.5 rounded-full bg-trust-suspect ${
            isConnecting ? 'mc-live-dot' : ''
          }`}
        />
        <span className="font-medium">
          {isConnecting
            ? 'Connecting to Chronyx telemetry stream...'
            : 'Live stream disconnected. Displaying last known verified state.'}
        </span>
      </div>
      <span className="font-mono text-[11px] opacity-85">
        {isConnecting ? 'handshake in progress' : 'reconnecting...'}
      </span>
    </div>
  );
};
