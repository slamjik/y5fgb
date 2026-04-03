import type { ClientPlatform, SessionPersistenceMode } from "@project/shared-types";

import {
  detectClientRuntime,
  type PlatformCapabilities,
  type SessionPolicy,
  webBrowserCapabilities,
  desktopTauriCapabilities,
} from "@project/client-core";

export interface PlatformAdapter {
  platform: ClientPlatform;
  capabilities: PlatformCapabilities;
  sessionPolicy: SessionPolicy;
}

export function createDesktopPlatformAdapter(): PlatformAdapter {
  return {
    platform: "desktop-tauri",
    capabilities: desktopTauriCapabilities,
    sessionPolicy: {
      sessionClass: "device",
      persistence: "remembered",
      allowRemembered: true,
    },
  };
}

export function createWebPlatformAdapter(defaultPersistence: SessionPersistenceMode = "ephemeral"): PlatformAdapter {
  return {
    platform: "web-browser",
    capabilities: webBrowserCapabilities,
    sessionPolicy: {
      sessionClass: "browser",
      persistence: defaultPersistence,
      allowRemembered: true,
    },
  };
}

export function createRuntimePlatformAdapter(): PlatformAdapter {
  const runtime = detectClientRuntime(typeof window !== "undefined" ? window : undefined);
  if (runtime.platform === "desktop-tauri") {
    return createDesktopPlatformAdapter();
  }
  return createWebPlatformAdapter();
}
