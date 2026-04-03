import type { ClientPlatform, SessionPersistenceMode, TransportLifecycleState } from "@project/shared-types";

import type { PlatformCapabilities } from "./capabilities";
import type { ServerBootstrapConfig } from "./server-config";

export interface SessionPolicyHints {
  defaultPersistence: SessionPersistenceMode;
  allowRemembered: boolean;
}

export interface AppBootstrapContext {
  platform: ClientPlatform;
  capabilities: PlatformCapabilities;
  server: ServerBootstrapConfig;
  sessionPolicy: SessionPolicyHints;
  lifecycleState: TransportLifecycleState;
}
