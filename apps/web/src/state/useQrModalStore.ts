import { create } from 'zustand';
import type { JoinInfo } from '@chronyx/contracts';
import { api } from '../api/client.js';

export interface QrModalStoreState {
  isOpen: boolean;
  data: JoinInfo | null;
  isLoading: boolean;
  error: string | null;

  // Actions
  openQrModal: () => void;
  closeQrModal: () => void;
  fetchJoinInfo: () => Promise<void>;
  reset: () => void;
}

let inFlightPromise: Promise<void> | null = null;

export const useQrModalStore = create<QrModalStoreState>((set, get) => ({
  isOpen: false,
  data: null,
  isLoading: false,
  error: null,

  openQrModal: (): void => {
    set({ isOpen: true });
    const { data, isLoading } = get();
    // If no cached data and not currently loading, fetch join credentials.
    // Reopening after an error (data is null) will automatically retry.
    if (!data && !isLoading) {
      void get().fetchJoinInfo();
    }
  },

  closeQrModal: (): void => {
    set({ isOpen: false });
  },

  fetchJoinInfo: async (): Promise<void> => {
    if (inFlightPromise) {
      return inFlightPromise;
    }

    set({ isLoading: true, error: null });

    inFlightPromise = (async () => {
      try {
        const info = await api.getJoinInfo();
        set({ data: info, isLoading: false, error: null });
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Failed to fetch join info';
        set({ error: message, isLoading: false });
      } finally {
        inFlightPromise = null;
      }
    })();

    return inFlightPromise;
  },

  reset: (): void => {
    inFlightPromise = null;
    set({ isOpen: false, data: null, isLoading: false, error: null });
  },
}));

/**
 * Public synchronous callback contract: openQrModal(): void
 * Exposes the store's openQrModal action without exposing internal async promises.
 */
export const openQrModal = (): void => {
  useQrModalStore.getState().openQrModal();
};

export const closeQrModal = (): void => {
  useQrModalStore.getState().closeQrModal();
};
