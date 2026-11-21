import React, { useEffect } from 'react';
import { Sidebar } from './Sidebar.js';
import { ConnectionBanner } from '../ui/ConnectionBanner.js';
import { JoinQrModal } from '../ui/JoinQrModal.js';
import { initDashboardSocket } from '../api/socket.js';
import { openQrModal, closeQrModal } from '../state/useQrModalStore.js';

export { openQrModal, closeQrModal };

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
    <div className="flex h-screen w-screen overflow-hidden bg-background text-foreground">
      <Sidebar showPassport={showPassport} onOpenQrModal={openQrModal} />
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <ConnectionBanner />
        <main className="flex-1 overflow-auto bg-background p-6">
          {children}
        </main>
      </div>
      <JoinQrModal />
    </div>
  );
};
