import React, { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { TopNav } from './TopNav.js';
import { ConnectionBanner } from '../ui/ConnectionBanner.js';
import { JoinQrModal } from '../ui/JoinQrModal.js';
import { initDashboardSocket } from '../api/socket.js';
import { openQrModal, closeQrModal } from '../state/useQrModalStore.js';
import { PresenterOverlay } from '../present/index.js';

export { openQrModal, closeQrModal };

export interface AppShellProps {
  children: React.ReactNode;
  showPassport?: boolean;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  showPassport = true,
}) => {
  const location = useLocation();
  const isGlobeRoute =
    location.pathname === '/overview' || location.pathname === '/observatory';

  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#06080d] text-foreground">
      <TopNav showPassport={showPassport} onOpenQrModal={openQrModal} />
      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative">
        <div className={isGlobeRoute ? 'fixed top-16 left-0 right-0 z-25 pointer-events-none [&>*]:pointer-events-auto' : 'pt-16'}>
          <PresenterOverlay onOpenQrModal={openQrModal} />
          <ConnectionBanner />
        </div>
        <main
          className={
            isGlobeRoute
              ? 'flex-1 min-h-0 overflow-hidden bg-[#06080d] relative'
              : 'flex-1 min-h-0 overflow-auto bg-background px-4 sm:px-6 pb-8 pt-4'
          }
        >
          {children}
        </main>
      </div>
      <JoinQrModal />
    </div>
  );
};
