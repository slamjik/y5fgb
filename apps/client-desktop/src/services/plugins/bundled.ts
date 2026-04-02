import type { PluginManifest } from "@project/protocol";

import type { LoadedPluginDescriptor } from "@/services/plugins/manifest";

const transportPanelManifest: PluginManifest = {
  apiVersion: "v1",
  id: "demo.transport.health" as PluginManifest["id"],
  name: "Transport Health Panel",
  version: "1.0.0",
  entrypoint: "index.js",
  requestedPermissions: ["ui.render", "events.subscribe", "notifications.local"],
  declaredHooks: ["transport.state.changed"],
  uiContributions: {
    panels: [{ id: "transport.health.panel" as PluginManifest["uiContributions"]["panels"][number]["id"], title: "Transport Health" }],
  },
};

const conversationSummaryManifest: PluginManifest = {
  apiVersion: "v1",
  id: "demo.conversation.summary" as PluginManifest["id"],
  name: "Conversation Summary",
  version: "1.0.0",
  entrypoint: "index.js",
  requestedPermissions: [
    "ui.render",
    "messages.read_active_conversation_summary",
    "messages.read_visible_messages",
    "events.subscribe",
  ],
  declaredHooks: ["conversation.changed", "message.visible"],
  uiContributions: {
    panels: [{ id: "conversation.summary.panel" as PluginManifest["uiContributions"]["panels"][number]["id"], title: "Conversation Snapshot" }],
  },
};

const localActionsManifest: PluginManifest = {
  apiVersion: "v1",
  id: "demo.local.actions" as PluginManifest["id"],
  name: "Local Actions",
  version: "1.0.0",
  entrypoint: "index.js",
  requestedPermissions: ["commands.register", "storage.plugin_local", "notifications.local", "ui.render"],
  declaredHooks: ["command.executed"],
  uiContributions: {
    panels: [{ id: "local.actions.panel" as PluginManifest["uiContributions"]["panels"][number]["id"], title: "Local Actions" }],
  },
};

const transportPanelCode = `
window.__SECURE_MESSENGER_PLUGIN_ENTRY__ = async function(api) {
  const panelId = "transport.health.panel";
  await api.ui.registerPanel({ id: panelId, title: "Transport Health" });
  await api.ui.setPanelContent(panelId, "Waiting for transport updates...");

  await api.events.subscribe("transport.state.changed", async function(event) {
    const payload = event && event.payload ? event.payload : {};
    const mode = payload.mode || "none";
    const status = payload.status || "offline";
    const endpoint = payload.endpoint || "-";
    const text = "Mode: " + mode + "\\nStatus: " + status + "\\nEndpoint: " + endpoint;
    await api.ui.setPanelContent(panelId, text);
  });
};
`;

const conversationSummaryCode = `
window.__SECURE_MESSENGER_PLUGIN_ENTRY__ = async function(api) {
  const panelId = "conversation.summary.panel";
  await api.ui.registerPanel({ id: panelId, title: "Conversation Snapshot" });

  async function refresh() {
    const summary = await api.messages.getActiveConversationSummary();
    const messages = await api.messages.getVisibleMessagesSanitized();
    if (!summary) {
      await api.ui.setPanelContent(panelId, "No active conversation.");
      return;
    }

    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
    const lines = [
      "Conversation: " + (summary.title || summary.id),
      "Type: " + summary.type,
      "Members: " + summary.memberCount,
      "Visible messages: " + messages.length,
      "Last message at: " + (lastMessage ? lastMessage.createdAt : "-"),
    ];
    await api.ui.setPanelContent(panelId, lines.join("\\n"));
  }

  await refresh();
  await api.events.subscribe("conversation.changed", refresh);
  await api.events.subscribe("message.visible", refresh);
};
`;

const localActionsCode = `
window.__SECURE_MESSENGER_PLUGIN_ENTRY__ = async function(api) {
  const panelId = "local.actions.panel";
  const commandId = "local.actions.increment";

  await api.ui.registerPanel({ id: panelId, title: "Local Actions" });
  await api.ui.setPanelContent(panelId, "Run the command from Plugin Manager.");

  await api.commands.register({
    id: commandId,
    title: "Increment local plugin counter",
    handler: async function() {
      const currentRaw = await api.storage.get("counter");
      const current = currentRaw ? Number(currentRaw) : 0;
      const next = Number.isFinite(current) ? current + 1 : 1;
      await api.storage.set("counter", String(next));
      await api.ui.setPanelContent(panelId, "Counter value: " + next);
      await api.notifications.showLocal("Plugin counter = " + next);
    }
  });
};
`;

export const bundledPluginDescriptors: LoadedPluginDescriptor[] = [
  {
    manifest: transportPanelManifest,
    source: "bundled",
    sourceRef: "bundled:demo.transport.health",
    entrypointCode: transportPanelCode,
  },
  {
    manifest: conversationSummaryManifest,
    source: "bundled",
    sourceRef: "bundled:demo.conversation.summary",
    entrypointCode: conversationSummaryCode,
  },
  {
    manifest: localActionsManifest,
    source: "bundled",
    sourceRef: "bundled:demo.local.actions",
    entrypointCode: localActionsCode,
  },
];

