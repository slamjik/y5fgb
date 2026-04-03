import { create } from "zustand";
import { persist } from "zustand/middleware";

export type UpdateChannel = "stable" | "beta";
export type UpdaterStatus =
  | "idle"
  | "unsupported"
  | "checking"
  | "up_to_date"
  | "available"
  | "downloading"
  | "downloaded"
  | "error";

interface UpdaterStore {
  supported: boolean;
  status: UpdaterStatus;
  channel: UpdateChannel;
  currentVersion: string | null;
  availableVersion: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
  progressPercent: number;
  lastCheckedAt: string | null;
  errorMessage: string | null;
  bannerVisible: boolean;
  dismissedVersion: string | null;
  setSupported: (value: boolean) => void;
  setStatus: (value: UpdaterStatus) => void;
  setChannel: (value: UpdateChannel) => void;
  setCurrentVersion: (value: string | null) => void;
  setAvailableUpdate: (payload: {
    version: string;
    notes?: string | null;
    publishedAt?: string | null;
    showBanner: boolean;
  }) => void;
  clearAvailableUpdate: () => void;
  setProgressPercent: (value: number) => void;
  setError: (value: string | null) => void;
  setBannerVisible: (value: boolean) => void;
  dismissCurrentVersion: () => void;
  markCheckedNow: () => void;
}

export const useUpdaterStore = create<UpdaterStore>()(
  persist(
    (set, get) => ({
      supported: true,
      status: "idle",
      channel: "stable",
      currentVersion: null,
      availableVersion: null,
      releaseNotes: null,
      publishedAt: null,
      progressPercent: 0,
      lastCheckedAt: null,
      errorMessage: null,
      bannerVisible: false,
      dismissedVersion: null,
      setSupported: (value) => set({ supported: value }),
      setStatus: (value) => set({ status: value }),
      setChannel: (value) => set({ channel: value }),
      setCurrentVersion: (value) => set({ currentVersion: value }),
      setAvailableUpdate: ({ version, notes, publishedAt, showBanner }) =>
        set((state) => ({
          status: "available",
          availableVersion: version,
          releaseNotes: notes ?? null,
          publishedAt: publishedAt ?? null,
          errorMessage: null,
          progressPercent: 0,
          bannerVisible: showBanner && state.dismissedVersion !== version,
        })),
      clearAvailableUpdate: () =>
        set({
          availableVersion: null,
          releaseNotes: null,
          publishedAt: null,
          progressPercent: 0,
          bannerVisible: false,
        }),
      setProgressPercent: (value) =>
        set({
          progressPercent: Number.isFinite(value) ? Math.min(100, Math.max(0, Math.floor(value))) : 0,
        }),
      setError: (value) =>
        set({
          status: value ? "error" : get().status,
          errorMessage: value,
        }),
      setBannerVisible: (value) => set({ bannerVisible: value }),
      dismissCurrentVersion: () =>
        set((state) => ({
          bannerVisible: false,
          dismissedVersion: state.availableVersion ?? state.dismissedVersion,
        })),
      markCheckedNow: () => set({ lastCheckedAt: new Date().toISOString() }),
    }),
    {
      name: "secure-messenger-updater-state",
      partialize: (state) => ({
        channel: state.channel,
        dismissedVersion: state.dismissedVersion,
      }),
    },
  ),
);
