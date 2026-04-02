import type {
  PluginDeclaredHook,
  PluginManifest,
} from "@project/protocol";
import type { PluginCapability, PluginID, PluginPanelID, PluginStatus } from "@project/shared-types";

import { isCapabilityAllowedInV1 } from "@/services/plugins/capabilities";

export type LoadedPluginSource = "bundled" | "local";

export interface LoadedPluginDescriptor {
  manifest: PluginManifest;
  source: LoadedPluginSource;
  sourceRef: string;
  entrypointCode: string;
}

export interface PluginValidationError {
  code:
    | "plugin_manifest_invalid"
    | "plugin_permission_denied"
    | "plugin_load_failed"
    | "plugin_runtime_init_failed"
    | "plugin_bridge_violation";
  message: string;
}

const idPattern = /^[a-z0-9._-]{3,64}$/;
const semverPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:[-+].+)?$/;

const allowedHooks = new Set<PluginDeclaredHook>([
  "conversation.changed",
  "transport.state.changed",
  "message.visible",
  "command.executed",
]);

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter((item) => item.length > 0);
}

function normalizeManifest(raw: unknown): PluginManifest | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }

  const source = raw as Record<string, unknown>;
  const apiVersion = asString(source.apiVersion);
  const id = asString(source.id);
  const name = asString(source.name);
  const version = asString(source.version);
  const entrypoint = asString(source.entrypoint);

  const permissions = asStringArray(source.requestedPermissions) as PluginCapability[];
  const declaredHooks = asStringArray(source.declaredHooks) as PluginDeclaredHook[];
  const uiContributions = (source.uiContributions ?? {}) as Record<string, unknown>;
  const panelsRaw = Array.isArray(uiContributions.panels) ? uiContributions.panels : [];
  const panels = panelsRaw
    .map((panel) => {
      if (typeof panel !== "object" || panel === null) {
        return null;
      }
      const panelRecord = panel as Record<string, unknown>;
      const panelId = asString(panelRecord.id);
      const panelTitle = asString(panelRecord.title);
      if (!panelId || !panelTitle) {
        return null;
      }
      return {
        id: panelId as PluginPanelID,
        title: panelTitle,
      };
    })
    .filter((item): item is { id: PluginPanelID; title: string } => item !== null);

  if (!apiVersion || !id || !name || !version || !entrypoint) {
    return null;
  }

  return {
    apiVersion: apiVersion as PluginManifest["apiVersion"],
    id: id as PluginID,
    name,
    version,
    entrypoint,
    requestedPermissions: permissions,
    declaredHooks,
    uiContributions: {
      panels,
    },
  };
}

export function validatePluginDescriptor(descriptor: LoadedPluginDescriptor): PluginValidationError | null {
  const manifest = normalizeManifest(descriptor.manifest);
  if (!manifest) {
    return { code: "plugin_manifest_invalid", message: "manifest shape is invalid" };
  }

  if (manifest.apiVersion !== "v1") {
    return { code: "plugin_manifest_invalid", message: "unsupported plugin apiVersion" };
  }
  if (!idPattern.test(manifest.id)) {
    return { code: "plugin_manifest_invalid", message: "plugin id must match /^[a-z0-9._-]{3,64}$/" };
  }
  if (!semverPattern.test(manifest.version)) {
    return { code: "plugin_manifest_invalid", message: "plugin version must be semver-like" };
  }
  if (manifest.entrypoint.includes("..") || manifest.entrypoint.startsWith("/") || manifest.entrypoint.startsWith("\\")) {
    return { code: "plugin_manifest_invalid", message: "entrypoint must be a relative path" };
  }
  if (descriptor.entrypointCode.trim().length === 0) {
    return { code: "plugin_load_failed", message: "plugin entrypoint code is empty" };
  }
  if (descriptor.entrypointCode.length > 512_000) {
    return { code: "plugin_load_failed", message: "plugin entrypoint exceeds maximum size" };
  }

  for (const capability of manifest.requestedPermissions) {
    if (!isCapabilityAllowedInV1(capability)) {
      return {
        code: "plugin_permission_denied",
        message: `capability '${capability}' is denied by default in v1`,
      };
    }
  }

  for (const hook of manifest.declaredHooks) {
    if (!allowedHooks.has(hook)) {
      return {
        code: "plugin_manifest_invalid",
        message: `declared hook '${hook}' is not supported`,
      };
    }
  }

  descriptor.manifest = manifest;
  return null;
}

export function buildInitialPluginStatus(enabled: boolean): PluginStatus {
  return enabled ? "enabled" : "installed";
}
