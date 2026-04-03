import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";

import { createInitialTransportLifecycle, type TransportLifecycleSnapshot } from "@project/client-core";

import { useAuth } from "./auth-context";
import { useBootstrap } from "./bootstrap-context";
import { createTransportController, type RuntimeTransportSnapshot } from "./transport-controller";

interface TransportContextValue {
  lifecycle: TransportLifecycleSnapshot;
  runtime: RuntimeTransportSnapshot;
  reconnect: () => void;
  lastError: string | null;
}

const initialRuntimeSnapshot: RuntimeTransportSnapshot = {
  mode: "none",
  status: "offline",
  endpoint: null,
  cursor: 0,
  queueSize: 0,
  updatedAt: new Date().toISOString(),
};

const TransportContext = createContext<TransportContextValue | null>(null);

export function TransportProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = useBootstrap();
  const auth = useAuth();
  const authPhase = auth.phase;
  const getAccessToken = auth.getAccessToken;
  const refreshAccessToken = auth.refreshAccessToken;
  const logout = auth.logout;
  const controllerRef = useRef<ReturnType<typeof createTransportController> | null>(null);

  const [lifecycle, setLifecycle] = useState<TransportLifecycleSnapshot>(createInitialTransportLifecycle());
  const [runtime, setRuntime] = useState<RuntimeTransportSnapshot>(initialRuntimeSnapshot);
  const [lastError, setLastError] = useState<string | null>(null);

  useEffect(() => {
    if (bootstrap.status !== "ready" || !bootstrap.serverConfig || authPhase !== "authenticated") {
      controllerRef.current?.stop();
      controllerRef.current = null;
      setRuntime({ ...initialRuntimeSnapshot, updatedAt: new Date().toISOString() });
      setLifecycle(createInitialTransportLifecycle());
      setLastError(null);
      return;
    }

    const controller = createTransportController({
      config: bootstrap.serverConfig,
      getAccessToken,
      refreshAccessToken,
      onLifecycle: setLifecycle,
      onRuntimeSnapshot: setRuntime,
      onForbidden: () => {
        void logout();
      },
      onError: (message) => setLastError(message),
    });
    controllerRef.current = controller;
    controller.start();

    return () => {
      controller.stop();
      controllerRef.current = null;
    };
  }, [authPhase, bootstrap.serverConfig, bootstrap.status, getAccessToken, logout, refreshAccessToken]);

  const value = useMemo<TransportContextValue>(
    () => ({
      lifecycle,
      runtime,
      reconnect: () => {
        setLastError(null);
        controllerRef.current?.reconnect();
      },
      lastError,
    }),
    [lifecycle, runtime, lastError],
  );

  return <TransportContext.Provider value={value}>{children}</TransportContext.Provider>;
}

export function useTransport(): TransportContextValue {
  const context = useContext(TransportContext);
  if (!context) {
    throw new Error("useTransport must be used inside TransportProvider");
  }
  return context;
}
