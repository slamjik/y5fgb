import type { PluginBridgeMethod } from "@project/protocol";
import type { PluginCapability } from "@project/shared-types";

export const allowedV1Capabilities: PluginCapability[] = [
  "ui.render",
  "commands.register",
  "storage.plugin_local",
  "notifications.local",
  "messages.read_active_conversation_summary",
  "messages.read_visible_messages",
  "events.subscribe",
];

export const deniedByDefaultCapabilities: PluginCapability[] = [
  "network.outbound",
  "filesystem.read",
  "filesystem.write",
  "transport.control",
  "auth.session",
  "crypto.keys",
  "identity.material",
];

export const pluginCapabilityByMethod: Record<PluginBridgeMethod, PluginCapability> = {
  registerCommand: "commands.register",
  registerPanel: "ui.render",
  setPanelContent: "ui.render",
  "pluginStorage.get": "storage.plugin_local",
  "pluginStorage.set": "storage.plugin_local",
  "pluginStorage.delete": "storage.plugin_local",
  "pluginStorage.list": "storage.plugin_local",
  "messages.getActiveConversationSummary": "messages.read_active_conversation_summary",
  "messages.getVisibleMessagesSanitized": "messages.read_visible_messages",
  "events.subscribe": "events.subscribe",
  "events.unsubscribe": "events.subscribe",
  "notifications.showLocal": "notifications.local",
};

const allowedSet = new Set(allowedV1Capabilities);
const deniedSet = new Set(deniedByDefaultCapabilities);

export function isCapabilityAllowedInV1(capability: PluginCapability): boolean {
  if (deniedSet.has(capability)) {
    return false;
  }
  return allowedSet.has(capability);
}
