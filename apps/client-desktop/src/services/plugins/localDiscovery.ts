import { invoke } from "@tauri-apps/api/core";

import { logger } from "@/services/logger";
import type { LoadedPluginDescriptor } from "@/services/plugins/manifest";

interface LocalPluginPayload {
  manifestJson: string;
  entrypointCode: string;
  sourceRef: string;
}

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function discoverLocalPlugins(): Promise<LoadedPluginDescriptor[]> {
  if (!isTauriRuntime()) {
    return [];
  }

  try {
    const payloads = await invoke<LocalPluginPayload[]>("plugins_discover_local");
    const descriptors: LoadedPluginDescriptor[] = [];
    for (const payload of payloads) {
      try {
        const parsedManifest = JSON.parse(payload.manifestJson);
        descriptors.push({
          manifest: parsedManifest,
          source: "local",
          sourceRef: payload.sourceRef,
          entrypointCode: payload.entrypointCode,
        });
      } catch (error) {
        logger.warn("skipped malformed local plugin manifest payload", { error: String(error), sourceRef: payload.sourceRef });
      }
    }
    return descriptors;
  } catch (error) {
    logger.warn("local plugin discovery failed", { error: String(error) });
    return [];
  }
}

