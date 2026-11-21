import React, { useEffect } from 'react';
import { Sidebar } from './Sidebar.js';
import { ConnectionBanner } from '../ui/ConnectionBanner.js';
import { initDashboardSocket } from '../api/socket.js';

export interface AppShellProps {
  children: React.ReactNode;
  showPassport?: boolean;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  showPassport = false,
}) => {
  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  return (
    <div className="chronyx-canvas relative flex h-screen w-screen overflow-hidden text-foreground">
      <Sidebar showPassport={showPassport} className="relative z-10" />
      <div className="relative z-10 flex-1 flex flex-col min-w-0 overflow-hidden">
        <ConnectionBanner />
        <main className="flex-1 overflow-auto p-6">
          <div className="mx-auto w-full max-w-[1520px]">{children}</div>
        </main>
      </div>
    </div>
  );
};
