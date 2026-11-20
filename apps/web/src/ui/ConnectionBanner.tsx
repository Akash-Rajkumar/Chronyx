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
        className={`w-full py-2 px-4 bg-accent-cyan/10 border-b border-accent-cyan/30 text-accent-cyan text-xs flex items-center justify-between transition-all duration-200 ${className}`}
      >
        <div className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full bg-accent-cyan" />
          <span className="font-medium">
            Mock Mode Active: Displaying simulated telemetry from frozen contract fixtures.
          </span>
        </div>
        <span className="font-mono text-[11px] opacity-80">VITE_USE_MOCKS=1</span>
      </div>
    );
  }

  const isConnecting = status === 'connecting';

  return (
    <div
      data-testid="connection-banner"
      role="status"
      className={`w-full py-2 px-4 bg-trust-suspect/10 border-b border-trust-suspect/30 text-trust-suspect text-xs flex items-center justify-between transition-all duration-200 ${className}`}
    >
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-trust-suspect animate-ping" />
        <span className="font-medium">
          {isConnecting
            ? 'Connecting to Chronyx telemetry stream...'
            : 'Live stream disconnected. Displaying last known verified state.'}
        </span>
      </div>
      <span className="font-mono text-[11px] opacity-80">
        {isConnecting ? 'handshake in progress' : 'reconnecting...'}
      </span>
    </div>
  );
};
