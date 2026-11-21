import React, { useEffect, useState } from 'react';
import { Sidebar } from './Sidebar.js';
import { ConnectionBanner } from '../ui/ConnectionBanner.js';
import { initDashboardSocket } from '../api/socket.js';
import { ObservatoryBackdrop } from './ObservatoryBackdrop.js';
import { QrJoinModal } from './QrJoinModal.js';
import { PresenterOverlay } from '../present/index.js';

export interface AppShellProps {
  children: React.ReactNode;
  showPassport?: boolean;
}

export const AppShell: React.FC<AppShellProps> = ({
  children,
  showPassport = false,
}) => {
  const [qrOpen, setQrOpen] = useState(false);

  useEffect(() => {
    const cleanup = initDashboardSocket();
    return cleanup;
  }, []);

  return (
    <div className="mc-canvas relative flex h-screen w-screen overflow-hidden text-foreground">
      <ObservatoryBackdrop />
      <Sidebar
        showPassport={showPassport}
        onOpenQrModal={() => setQrOpen(true)}
        className="relative z-10"
      />
      <div className="relative z-10 flex-1 flex flex-col min-w-0 overflow-hidden">
        <ConnectionBanner />
        <PresenterOverlay onOpenQrModal={() => setQrOpen(true)} />
        <main className="flex-1 overflow-auto p-5 lg:p-6">
          <div className="mx-auto w-full max-w-[1560px]">{children}</div>
        </main>
      </div>
      <QrJoinModal open={qrOpen} onClose={() => setQrOpen(false)} />
    </div>
  );
};
