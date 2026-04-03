import { getVersion } from "@tauri-apps/api/app";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

import { logger } from "@/services/logger";
import { useUpdaterStore } from "@/state/updaterStore";

let activeUpdate: Update | null = null;
let backgroundInitialized = false;

function isTauriRuntime() {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function mapUpdateError(error: unknown): string {
  const message = String(error ?? "").toLowerCase();
  if (message.includes("network") || message.includes("timed out") || message.includes("timeout")) {
    return "network";
  }
  if (message.includes("signature") || message.includes("pubkey")) {
    return "signature";
  }
  if (message.includes("tls") || message.includes("certificate")) {
    return "tls";
  }
  if (message.includes("no update") || message.includes("204")) {
    return "none";
  }
  return "unknown";
}

export interface UpdateCheckResult {
  hasUpdate: boolean;
  version?: string;
  notes?: string | null;
  publishedAt?: string | null;
  reason?: "none" | "unsupported";
}

export const updaterService = {
  async initializeBackgroundChecks() {
    if (backgroundInitialized) {
      return;
    }
    backgroundInitialized = true;

    if (!isTauriRuntime()) {
      useUpdaterStore.getState().setSupported(false);
      useUpdaterStore.getState().setStatus("unsupported");
      return;
    }

    try {
      const version = await getVersion();
      useUpdaterStore.getState().setCurrentVersion(version);
      useUpdaterStore.getState().setSupported(true);
    } catch (error) {
      logger.warn("failed to read app version for updater", { error });
    }

    try {
      await this.checkForUpdates({ manual: false, showBanner: true });
    } catch (error) {
      logger.warn("background updater check failed", { error });
    }
  },

  async checkForUpdates(options?: { manual?: boolean; showBanner?: boolean }): Promise<UpdateCheckResult> {
    const manual = options?.manual ?? false;
    const showBanner = options?.showBanner ?? false;
    const store = useUpdaterStore.getState();
    const channel = store.channel;

    if (!isTauriRuntime()) {
      store.setSupported(false);
      store.setStatus("unsupported");
      store.setError("unsupported");
      return { hasUpdate: false, reason: "unsupported" };
    }

    store.setStatus("checking");
    store.setError(null);
    store.markCheckedNow();

    try {
      const update = await check({
        headers: {
          "x-update-channel": channel,
        },
      });
      activeUpdate = update;

      if (!update) {
        store.setStatus("up_to_date");
        store.clearAvailableUpdate();
        return { hasUpdate: false, reason: "none" };
      }

      store.setAvailableUpdate({
        version: update.version,
        notes: update.body ?? null,
        publishedAt: update.date ?? null,
        showBanner,
      });

      return {
        hasUpdate: true,
        version: update.version,
        notes: update.body ?? null,
        publishedAt: update.date ?? null,
      };
    } catch (error) {
      const classified = mapUpdateError(error);
      store.setStatus("error");
      store.setError(classified);
      logger.warn("updater check failed", {
        manual,
        channel,
        classified,
        error,
      });
      throw error;
    }
  },

  async downloadAndInstallUpdate(): Promise<void> {
    const store = useUpdaterStore.getState();
    const channel = store.channel;

    if (!activeUpdate) {
      throw new Error("no_update_available");
    }

    store.setStatus("downloading");
    store.setProgressPercent(0);
    store.setError(null);

    let downloaded = 0;
    let total = 0;

    const onEvent = (event: DownloadEvent) => {
      if (event.event === "Started") {
        total = event.data.contentLength ?? 0;
        downloaded = 0;
        store.setProgressPercent(0);
        return;
      }

      if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (total > 0) {
          store.setProgressPercent((downloaded / total) * 100);
        }
        return;
      }

      store.setProgressPercent(100);
    };

    try {
      await activeUpdate.downloadAndInstall(onEvent, {
        headers: {
          "x-update-channel": channel,
        },
      });
      store.setStatus("downloaded");
      store.setProgressPercent(100);
    } catch (error) {
      const classified = mapUpdateError(error);
      store.setStatus("error");
      store.setError(classified);
      logger.warn("updater download/install failed", {
        classified,
        error,
      });
      throw error;
    }
  },

  async relaunchToApplyUpdate(): Promise<void> {
    if (!isTauriRuntime()) {
      return;
    }
    await relaunch();
  },

  dismissUpdateBanner() {
    useUpdaterStore.getState().dismissCurrentVersion();
  },
};
