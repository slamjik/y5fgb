import type { ClientPlatform } from "@project/shared-types";

import { desktopTauriCapabilities, type PlatformCapabilities, webBrowserCapabilities } from "./capabilities";

export interface ClientRuntimeDescriptor {
  platform: ClientPlatform;
  isSecureContext: boolean;
  capabilities: PlatformCapabilities;
}

export function detectClientRuntime(globalObj: Window | undefined): ClientRuntimeDescriptor {
  const hasWindow = typeof globalObj !== "undefined";
  const isTauri = hasWindow && "__TAURI_INTERNALS__" in globalObj;
  const secureContext = hasWindow ? Boolean(globalObj.isSecureContext) : false;

  if (isTauri) {
    return {
      platform: "desktop-tauri",
      isSecureContext: secureContext,
      capabilities: desktopTauriCapabilities,
    };
  }

  return {
    platform: "web-browser",
    isSecureContext: secureContext,
    capabilities: webBrowserCapabilities,
  };
}
