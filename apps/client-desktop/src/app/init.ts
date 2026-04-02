import { logger } from "@/services/logger";
import { pluginRuntime } from "@/services/plugins/runtime";
import { bootstrapSession } from "@/services/sessionBootstrap";
import { useAppStore } from "@/state/appStore";

let initialized = false;

export async function initApp() {
  if (initialized) {
    return;
  }

  initialized = true;
  const now = new Date().toISOString();

  try {
    await bootstrapSession();
  } catch (error) {
    logger.warn("Session bootstrap produced an unhandled error", { error });
  }

  try {
    await pluginRuntime.start();
  } catch (error) {
    logger.warn("Plugin runtime bootstrap failed", { error });
  }

  useAppStore.getState().setInitialized(true);
  useAppStore.getState().setLastInitAt(now);

  logger.info("Application initialized", { at: now });
}
