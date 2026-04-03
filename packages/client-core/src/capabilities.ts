import type { ClientPlatform } from "@project/shared-types";

export interface PlatformCapabilities {
  secureLocalStorage: boolean;
  indexedDbStorage: boolean;
  nativeFileDialogs: boolean;
  binaryAttachmentStreaming: boolean;
  websocketSupport: boolean;
  backgroundReconnect: boolean;
  multiWindow: boolean;
  systemNotifications: boolean;
  clipboardIntegration: boolean;
  deepLinks: boolean;
  nativeAutoUpdate: boolean;
  trustedDevicePersistence: boolean;
  ephemeralSessionMode: boolean;
}

export interface PlatformIdentity {
  platform: ClientPlatform;
  version: string;
}

export const desktopTauriCapabilities: PlatformCapabilities = {
  secureLocalStorage: true,
  indexedDbStorage: false,
  nativeFileDialogs: true,
  binaryAttachmentStreaming: true,
  websocketSupport: true,
  backgroundReconnect: true,
  multiWindow: true,
  systemNotifications: true,
  clipboardIntegration: true,
  deepLinks: true,
  nativeAutoUpdate: true,
  trustedDevicePersistence: true,
  ephemeralSessionMode: true,
};

export const webBrowserCapabilities: PlatformCapabilities = {
  secureLocalStorage: false,
  indexedDbStorage: true,
  nativeFileDialogs: false,
  binaryAttachmentStreaming: false,
  websocketSupport: true,
  backgroundReconnect: false,
  multiWindow: false,
  systemNotifications: false,
  clipboardIntegration: true,
  deepLinks: false,
  nativeAutoUpdate: false,
  trustedDevicePersistence: false,
  ephemeralSessionMode: true,
};

export function hasCapability<K extends keyof PlatformCapabilities>(
  capabilities: PlatformCapabilities,
  key: K,
): boolean {
  return Boolean(capabilities[key]);
}
