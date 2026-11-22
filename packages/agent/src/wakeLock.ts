/**
 * Screen Wake Lock manager with graceful fallback.
 */

interface WakeLockSentinelLike {
  released: boolean;
  type: string;
  release(): Promise<void>;
  addEventListener?(type: string, listener: () => void): void;
}

interface NavigatorWithWakeLock {
  wakeLock?: {
    request(type: 'screen'): Promise<WakeLockSentinelLike>;
  };
}

export class WakeLockManager {
  private sentinel: WakeLockSentinelLike | null = null;
  private isRequested = false;
  private visibilityHandler: (() => void) | null = null;

  public isSupported(): boolean {
    if (typeof navigator === 'undefined') return false;
    const nav = navigator as NavigatorWithWakeLock;
    return typeof nav.wakeLock?.request === 'function';
  }

  public async acquire(): Promise<boolean> {
    this.isRequested = true;
    if (!this.isSupported()) {
      return false;
    }

    try {
      const nav = navigator as NavigatorWithWakeLock;
      this.sentinel = await nav.wakeLock!.request('screen');
      this.sentinel.addEventListener?.('release', () => {
        this.sentinel = null;
      });

      if (!this.visibilityHandler && typeof document !== 'undefined') {
        this.visibilityHandler = async () => {
          if (this.isRequested && document.visibilityState === 'visible' && !this.sentinel) {
            try {
              const innerNav = navigator as NavigatorWithWakeLock;
              this.sentinel = await innerNav.wakeLock!.request('screen');
            } catch {
              // Silently ignore re-acquisition failure
            }
          }
        };
        document.addEventListener('visibilitychange', this.visibilityHandler);
      }
      return true;
    } catch {
      this.sentinel = null;
      return false;
    }
  }

  public async release(): Promise<void> {
    this.isRequested = false;
    if (this.visibilityHandler && typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.visibilityHandler);
      this.visibilityHandler = null;
    }

    if (this.sentinel) {
      try {
        await this.sentinel.release();
      } catch {
        // Ignore release error
      }
      this.sentinel = null;
    }
  }

  public isActive(): boolean {
    return this.sentinel !== null;
  }
}
