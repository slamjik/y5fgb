import type {
  LoginPendingApprovalResponse,
  LoginSuccessResponse,
  LoginTwoFactorRequiredResponse,
  RegisterResponse,
} from "@project/protocol";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface AuthSessionState {
  accountId: string;
  email: string;
  twoFactorEnabled: boolean;
  identity: RegisterResponse["identity"];
  device: RegisterResponse["device"];
  session: RegisterResponse["session"];
}

interface AuthStore {
  initialized: boolean;
  accessToken: string | null;
  session: AuthSessionState | null;
  pendingApproval: LoginPendingApprovalResponse | null;
  twoFAChallenge: LoginTwoFactorRequiredResponse | null;
  recoveryCodes: string[];
  setInitialized: (value: boolean) => void;
  setSessionFromEnvelope: (payload: RegisterResponse | LoginSuccessResponse) => void;
  updateSessionDetails: (payload: {
    email: string;
    twoFactorEnabled: boolean;
    identity: RegisterResponse["identity"];
    device: RegisterResponse["device"];
    session: RegisterResponse["session"];
  }) => void;
  clearSession: () => void;
  setAccessToken: (value: string | null) => void;
  setPendingApproval: (payload: LoginPendingApprovalResponse | null) => void;
  setTwoFAChallenge: (payload: LoginTwoFactorRequiredResponse | null) => void;
  setRecoveryCodes: (payload: string[]) => void;
}

export const useAuthStore = create<AuthStore>()(
  persist(
    (set) => ({
      initialized: false,
      accessToken: null,
      session: null,
      pendingApproval: null,
      twoFAChallenge: null,
      recoveryCodes: [],
      setInitialized: (value) => set({ initialized: value }),
      setSessionFromEnvelope: (payload) =>
        set({
          session: {
            accountId: payload.accountId,
            email: "",
            twoFactorEnabled: false,
            identity: payload.identity,
            device: payload.device,
            session: payload.session,
          },
          accessToken: payload.tokens.accessToken,
          pendingApproval: null,
          twoFAChallenge: null,
          recoveryCodes: payload.recoveryCodes ?? [],
        }),
      updateSessionDetails: (payload) =>
        set((state) => {
          if (!state.session) {
            return state;
          }

          return {
            session: {
              ...state.session,
              email: payload.email,
              twoFactorEnabled: payload.twoFactorEnabled,
              identity: payload.identity,
              device: payload.device,
              session: payload.session,
            },
          };
        }),
      clearSession: () =>
        set({
          session: null,
          accessToken: null,
          pendingApproval: null,
          twoFAChallenge: null,
          recoveryCodes: [],
        }),
      setAccessToken: (value) => set({ accessToken: value }),
      setPendingApproval: (payload) => set({ pendingApproval: payload }),
      setTwoFAChallenge: (payload) => set({ twoFAChallenge: payload }),
      setRecoveryCodes: (payload) => set({ recoveryCodes: payload }),
    }),
    {
      name: "secure-messenger-ui-state",
      version: 2,
      migrate: (persistedState) => ({
        session: ((persistedState as { session?: AuthSessionState | null } | undefined)?.session ?? null) as AuthSessionState | null,
      }),
      partialize: (state) => ({
        session: state.session,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        session: ((persistedState as { session?: AuthSessionState | null } | undefined)?.session ?? null) as AuthSessionState | null,
      }),
    },
  ),
);
