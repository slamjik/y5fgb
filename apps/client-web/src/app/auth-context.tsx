import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type {
  AuthSessionResponse,
  LoginSuccessResponse,
  SessionDTO,
  TokensDTO,
  WebLoginRequest,
  WebRefreshRequest,
  WebTwoFactorLoginVerifyRequest,
} from "@project/protocol";
import type { SessionPersistenceMode } from "@project/shared-types";
import { createIndexedDbStateStore, createMemorySecretVault, createMultiTabCoordinator } from "@project/platform-adapters";

import { HttpRequestError, requestJSON } from "../lib/http";
import { useBootstrap } from "./bootstrap-context";

export type AuthPhase = "idle" | "restoring" | "unauthenticated" | "two_fa_required" | "authenticated" | "error";

export interface SessionView {
  accountId: string;
  email: string;
  twoFactorEnabled: boolean;
  session: SessionDTO;
}

interface TwoFAChallengeState {
  challengeId: string;
  loginToken: string;
  expiresAt: string;
  requestedPersistence: SessionPersistenceMode;
}

interface AuthContextValue {
  phase: AuthPhase;
  session: SessionView | null;
  challenge: TwoFAChallengeState | null;
  errorMessage: string | null;
  persistenceMode: SessionPersistenceMode;
  setPersistenceMode: (mode: SessionPersistenceMode) => void;
  login: (email: string, password: string) => Promise<boolean>;
  verifyTwoFactor: (code: string) => Promise<boolean>;
  logout: () => Promise<void>;
  logoutAll: () => Promise<void>;
  refreshAccessToken: () => Promise<boolean>;
  getAccessToken: () => Promise<string | null>;
  clearError: () => void;
}

const refreshTokenStorageKey = "session.refresh_token";
const persistenceModeStorageKey = "session.persistence_mode";

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = useBootstrap();
  const vaultRef = useRef(createMemorySecretVault());
  const stateStoreRef = useRef(createIndexedDbStateStore());
  const coordinatorRef = useRef(createMultiTabCoordinator());

  const [phase, setPhase] = useState<AuthPhase>("idle");
  const [session, setSession] = useState<SessionView | null>(null);
  const [challenge, setChallenge] = useState<TwoFAChallengeState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistenceMode, setPersistenceModeState] = useState<SessionPersistenceMode>("ephemeral");

  useEffect(() => {
    const unsubscribe = coordinatorRef.current.subscribe((event) => {
      if (event.type === "logout" || event.type === "session_invalidated") {
        void clearLocalSession(false);
      }
    });
    return () => {
      unsubscribe();
      coordinatorRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (bootstrap.status !== "ready" || !bootstrap.serverConfig) {
      setPhase(bootstrap.status === "booting" ? "idle" : "unauthenticated");
      return;
    }

    void restoreSession(bootstrap.serverConfig.apiBaseUrl, bootstrap.serverConfig.apiPrefix);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap.status, bootstrap.serverConfig?.apiBaseUrl, bootstrap.serverConfig?.apiPrefix]);

  const setPersistenceMode = useCallback((mode: SessionPersistenceMode) => {
    setPersistenceModeState(mode);
  }, []);

  const clearError = useCallback(() => setErrorMessage(null), []);

  const login = useCallback(
    async (email: string, password: string): Promise<boolean> => {
      if (bootstrap.status !== "ready" || !bootstrap.serverConfig) {
        setErrorMessage("Server is not configured.");
        return false;
      }

      setErrorMessage(null);
      setChallenge(null);

      try {
        const payload: WebLoginRequest = {
          email,
          password,
          sessionPersistence: persistenceMode,
        };

        const response = await requestJSON<LoginSuccessResponse>({
          method: "POST",
          url: buildURL(bootstrap.serverConfig.apiBaseUrl, bootstrap.serverConfig.apiPrefix, "/auth/web/login"),
          body: payload,
        });

        await applySessionEnvelope(response, persistenceMode, bootstrap.serverConfig.apiBaseUrl, bootstrap.serverConfig.apiPrefix);
        coordinatorRef.current.publish({ type: "session_refreshed" });
        return true;
      } catch (error) {
        if (error instanceof HttpRequestError && error.code === "two_fa_required") {
          const payload = error.payload as Record<string, unknown> | undefined;
          const challengeId = typeof payload?.challengeId === "string" ? payload.challengeId : "";
          const loginToken = typeof payload?.loginToken === "string" ? payload.loginToken : "";
          const expiresAt = typeof payload?.expiresAt === "string" ? payload.expiresAt : "";

          if (challengeId && loginToken) {
            setChallenge({
              challengeId,
              loginToken,
              expiresAt,
              requestedPersistence: persistenceMode,
            });
            setPhase("two_fa_required");
            return false;
          }
        }

        setErrorMessage(mapAuthError(error));
        setPhase("error");
        return false;
      }
    },
    [bootstrap.serverConfig, bootstrap.status, persistenceMode],
  );

  const verifyTwoFactor = useCallback(
    async (code: string): Promise<boolean> => {
      if (!challenge || bootstrap.status !== "ready" || !bootstrap.serverConfig) {
        setErrorMessage("Two-factor challenge is missing.");
        return false;
      }

      setErrorMessage(null);
      try {
        const payload: WebTwoFactorLoginVerifyRequest = {
          challengeId: challenge.challengeId,
          loginToken: challenge.loginToken,
          code,
          sessionPersistence: challenge.requestedPersistence,
        };

        const response = await requestJSON<LoginSuccessResponse>({
          method: "POST",
          url: buildURL(bootstrap.serverConfig.apiBaseUrl, bootstrap.serverConfig.apiPrefix, "/auth/web/2fa/verify"),
          body: payload,
        });

        await applySessionEnvelope(
          response,
          challenge.requestedPersistence,
          bootstrap.serverConfig.apiBaseUrl,
          bootstrap.serverConfig.apiPrefix,
        );
        setChallenge(null);
        coordinatorRef.current.publish({ type: "session_refreshed" });
        return true;
      } catch (error) {
        setErrorMessage(mapAuthError(error));
        setPhase("error");
        return false;
      }
    },
    [bootstrap.serverConfig, bootstrap.status, challenge],
  );

  const refreshAccessToken = useCallback(async (): Promise<boolean> => {
    if (bootstrap.status !== "ready" || !bootstrap.serverConfig) {
      return false;
    }

    const refreshToken = await getRefreshToken();
    if (!refreshToken) {
      return false;
    }

    try {
      const response = await requestJSON<LoginSuccessResponse>({
        method: "POST",
        url: buildURL(bootstrap.serverConfig.apiBaseUrl, bootstrap.serverConfig.apiPrefix, "/auth/web/refresh"),
        body: { refreshToken } satisfies WebRefreshRequest,
      });

      const mode = await resolvePersistenceMode();
      await applySessionEnvelope(response, mode, bootstrap.serverConfig.apiBaseUrl, bootstrap.serverConfig.apiPrefix);
      coordinatorRef.current.publish({ type: "session_refreshed" });
      return true;
    } catch {
      await clearLocalSession(true);
      coordinatorRef.current.publish({ type: "session_invalidated" });
      return false;
    }
  }, [bootstrap.serverConfig, bootstrap.status]);

  const logout = useCallback(async (): Promise<void> => {
    if (bootstrap.status !== "ready" || !bootstrap.serverConfig) {
      await clearLocalSession(false);
      return;
    }

    const [accessToken, refreshToken] = await Promise.all([
      vaultRef.current.get("session.access_token"),
      getRefreshToken(),
    ]);

    if (accessToken) {
      try {
        await requestJSON<{ ok: true }>({
          method: "POST",
          url: buildURL(bootstrap.serverConfig.apiBaseUrl, bootstrap.serverConfig.apiPrefix, "/auth/web/logout"),
          accessToken,
          body: refreshToken ? { refreshToken } : undefined,
        });
      } catch {
        // local cleanup still applies
      }
    }

    await clearLocalSession(true);
    coordinatorRef.current.publish({ type: "logout" });
  }, [bootstrap.serverConfig, bootstrap.status]);

  const logoutAll = useCallback(async (): Promise<void> => {
    if (bootstrap.status !== "ready" || !bootstrap.serverConfig) {
      await clearLocalSession(false);
      return;
    }

    const accessToken = await vaultRef.current.get("session.access_token");
    if (accessToken) {
      try {
        await requestJSON<{ revokedSessions: number }>({
          method: "POST",
          url: buildURL(bootstrap.serverConfig.apiBaseUrl, bootstrap.serverConfig.apiPrefix, "/auth/web/logout-all"),
          accessToken,
        });
      } catch {
        // local cleanup still applies
      }
    }

    await clearLocalSession(true);
    coordinatorRef.current.publish({ type: "session_invalidated" });
  }, [bootstrap.serverConfig, bootstrap.status]);

  const getAccessToken = useCallback(async () => vaultRef.current.get("session.access_token"), []);

  const value = useMemo<AuthContextValue>(
    () => ({
      phase,
      session,
      challenge,
      errorMessage,
      persistenceMode,
      setPersistenceMode,
      login,
      verifyTwoFactor,
      logout,
      logoutAll,
      refreshAccessToken,
      getAccessToken,
      clearError,
    }),
    [
      phase,
      session,
      challenge,
      errorMessage,
      persistenceMode,
      setPersistenceMode,
      login,
      verifyTwoFactor,
      logout,
      logoutAll,
      refreshAccessToken,
      getAccessToken,
      clearError,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;

  async function resolvePersistenceMode(): Promise<SessionPersistenceMode> {
    const stored = await stateStoreRef.current.get(persistenceModeStorageKey);
    if (stored === "remembered") {
      return "remembered";
    }
    return "ephemeral";
  }

  async function getRefreshToken(): Promise<string | null> {
    const inMemory = await vaultRef.current.get("session.refresh_token");
    if (inMemory) {
      return inMemory;
    }
    const mode = await resolvePersistenceMode();
    if (mode !== "remembered") {
      return null;
    }
    return stateStoreRef.current.get(refreshTokenStorageKey);
  }

  async function applySessionEnvelope(
    envelope: LoginSuccessResponse,
    mode: SessionPersistenceMode,
    apiBaseUrl: string,
    apiPrefix: string,
  ): Promise<void> {
    const tokens = envelope.tokens as TokensDTO;
    await vaultRef.current.set("session.access_token", tokens.accessToken);
    await vaultRef.current.set("session.refresh_token", tokens.refreshToken);

    await stateStoreRef.current.set(persistenceModeStorageKey, mode);
    if (mode === "remembered") {
      await stateStoreRef.current.set(refreshTokenStorageKey, tokens.refreshToken);
    } else {
      await stateStoreRef.current.delete(refreshTokenStorageKey);
    }

    setPersistenceModeState(mode);

    const hydrated = await hydrateSessionView(envelope, apiBaseUrl, apiPrefix, tokens.accessToken);
    setSession(hydrated);
    setPhase("authenticated");
  }

  async function hydrateSessionView(
    envelope: LoginSuccessResponse,
    apiBaseUrl: string,
    apiPrefix: string,
    accessToken: string,
  ): Promise<SessionView> {
    try {
      const response = await requestJSON<AuthSessionResponse>({
        method: "GET",
        url: buildURL(apiBaseUrl, apiPrefix, "/auth/web/session"),
        accessToken,
      });
      return {
        accountId: response.accountId,
        email: response.email,
        twoFactorEnabled: response.twoFactorEnabled,
        session: response.session,
      };
    } catch {
      return {
        accountId: envelope.accountId,
        email: "",
        twoFactorEnabled: false,
        session: envelope.session,
      };
    }
  }

  async function clearLocalSession(resetPersistenceMode: boolean): Promise<void> {
    await vaultRef.current.clear();
    await stateStoreRef.current.delete(refreshTokenStorageKey);
    if (resetPersistenceMode) {
      await stateStoreRef.current.delete(persistenceModeStorageKey);
      setPersistenceModeState("ephemeral");
    }
    setSession(null);
    setChallenge(null);
    setErrorMessage(null);
    setPhase("unauthenticated");
  }

  async function restoreSession(apiBaseUrl: string, apiPrefix: string): Promise<void> {
    setErrorMessage(null);
    setChallenge(null);

    const mode = await resolvePersistenceMode();
    setPersistenceModeState(mode);

    const refreshToken = mode === "remembered" ? await stateStoreRef.current.get(refreshTokenStorageKey) : null;
    if (!refreshToken) {
      setSession(null);
      setPhase("unauthenticated");
      return;
    }

    setPhase("restoring");

    try {
      const response = await requestJSON<LoginSuccessResponse>({
        method: "POST",
        url: buildURL(apiBaseUrl, apiPrefix, "/auth/web/refresh"),
        body: { refreshToken } satisfies WebRefreshRequest,
      });
      await applySessionEnvelope(response, mode, apiBaseUrl, apiPrefix);
    } catch (error) {
      await clearLocalSession(true);
      setErrorMessage(mapAuthError(error));
    }
  }
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }
  return context;
}

function buildURL(apiBaseUrl: string, apiPrefix: string, path: string): string {
  const cleanedPath = path.startsWith("/") ? path.slice(1) : path;
  const cleanedPrefix = apiPrefix.endsWith("/") ? apiPrefix.slice(0, -1) : apiPrefix;
  return new URL(`${cleanedPrefix}/${cleanedPath}`, `${apiBaseUrl}/`).toString();
}

function mapAuthError(error: unknown): string {
  if (error instanceof HttpRequestError) {
    if (error.code === "invalid_credentials") {
      return "Invalid email or password.";
    }
    if (error.code === "two_fa_required") {
      return "Two-factor verification is required.";
    }
    if (error.code === "endpoint_unreachable") {
      return "Network is unreachable. Check your connection.";
    }
    return error.message;
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "Authentication request failed.";
}
