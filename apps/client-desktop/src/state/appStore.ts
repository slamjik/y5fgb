import { create } from "zustand";
import { persist } from "zustand/middleware";

import { LANGUAGE_STORAGE_KEY, detectPreferredLanguage, type AppLanguage } from "@/services/i18n";

const ONBOARDING_STORAGE_KEY = "secure-messenger-onboarding-completed";

function readOnboardingCompleted() {
  if (typeof localStorage === "undefined") {
    return false;
  }
  return localStorage.getItem(ONBOARDING_STORAGE_KEY) === "1";
}

interface AppState {
  initialized: boolean;
  lastInitAt: string | null;
  language: AppLanguage;
  onboardingCompleted: boolean;
  setInitialized: (value: boolean) => void;
  setLastInitAt: (value: string) => void;
  setLanguage: (value: AppLanguage) => void;
  setOnboardingCompleted: (value: boolean) => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      initialized: false,
      lastInitAt: null,
      language: detectPreferredLanguage(),
      onboardingCompleted: readOnboardingCompleted(),
      setInitialized: (value) => set({ initialized: value }),
      setLastInitAt: (value) => set({ lastInitAt: value }),
      setLanguage: (value) => {
        const next = value === "en" ? "en" : "ru";
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
        }
        set({ language: next });
      },
      setOnboardingCompleted: (value) => {
        if (typeof localStorage !== "undefined") {
          localStorage.setItem(ONBOARDING_STORAGE_KEY, value ? "1" : "0");
        }
        set({ onboardingCompleted: value });
      },
    }),
    {
      name: "secure-messenger-app-state",
      partialize: (state) => ({
        language: state.language,
        onboardingCompleted: state.onboardingCompleted,
      }),
    },
  ),
);

