import type {
  PluginBridgeRequest,
  PluginBridgeResponse,
  PluginCommandDTO,
  PluginDeclaredHook,
  PluginEventPayload,
  PluginManifest,
  PluginPanelDTO,
  PluginRegistryItem,
} from "@project/protocol";
import type { PluginCapability } from "@project/shared-types";

import { randomID } from "@/lib/randomId";
import { logger } from "@/services/logger";
import { bundledPluginDescriptors } from "@/services/plugins/bundled";
import { isCapabilityAllowedInV1, pluginCapabilityByMethod } from "@/services/plugins/capabilities";
import { discoverLocalPlugins } from "@/services/plugins/localDiscovery";
import { type LoadedPluginDescriptor, validatePluginDescriptor } from "@/services/plugins/manifest";
import { useMessagingStore } from "@/state/messagingStore";
import { usePluginStore } from "@/state/pluginStore";

type PluginBridgeRequestEnvelope = PluginBridgeRequest & { kind: "plugin.bridge.request"; runtimeToken?: string };

type PluginRuntimeMessage =
  | { kind: "plugin.runtime.ready"; pluginId?: string; bootstrapToken?: string }
  | { kind: "plugin.runtime.initialized"; pluginId: string; runtimeToken?: string; bootstrapToken?: string }
  | { kind: "plugin.runtime.error"; pluginId?: string; message: string; runtimeToken?: string; bootstrapToken?: string }
  | PluginBridgeRequestEnvelope;

type RuntimeEventType = PluginDeclaredHook;

type ActivePluginInstance = {
  descriptor: LoadedPluginDescriptor;
  iframe: HTMLIFrameElement;
  bootstrapToken: string;
  runtimeToken: string;
  grantedPermissions: Set<PluginCapability>;
  subscriptions: Set<RuntimeEventType>;
  commands: PluginCommandDTO[];
  panels: PluginPanelDTO[];
  readyResolve: (() => void) | null;
  readyPromise: Promise<void>;
  initializedResolve: (() => void) | null;
  initializedPromise: Promise<void>;
};

const RUNTIME_READY_TIMEOUT_MS = 5_000;
const RUNTIME_INIT_TIMEOUT_MS = 5_000;
const sandboxRootID = "plugin-sandbox-root";
const MAX_BRIDGE_PAYLOAD_BYTES = 64 * 1024;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_ID_LENGTH = 96;
const MAX_STORAGE_VALUE_BYTES = 20_000;
const MAX_PANEL_CONTENT_LENGTH = 5_000;
const storageKeyPattern = /^[a-zA-Z0-9._-]{1,128}$/;
const runtimeIDPattern = /^[a-zA-Z0-9._-]{1,96}$/;

const allowedEventTypes = new Set<RuntimeEventType>([
  "conversation.changed",
  "transport.state.changed",
  "message.visible",
  "command.executed",
]);

function sanitizeForScript(value: string): string {
  return value.replace(/<\/script/gi, "<\\/script");
}

function nowISO() {
  return new Date().toISOString() as PluginRegistryItem["updatedAt"];
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export class PluginRuntime {
  private started = false;
  private descriptors = new Map<string, LoadedPluginDescriptor>();
  private activeInstances = new Map<string, ActivePluginInstance>();
  private unlistenMessagingStore: (() => void) | null = null;
  private transportSnapshot = "";
  private activeConversationSnapshot = "";
  private visibleMessageSnapshot = "";
  private boundMessageHandler = (event: MessageEvent) => {
    void this.handleWindowMessage(event);
  };

  async start() {
    if (this.started) {
      return;
    }
    this.started = true;
    window.addEventListener("message", this.boundMessageHandler);
    this.attachMessagingSubscriptions();
    await this.refreshDiscovery();
  }

  stop() {
    if (!this.started) {
      return;
    }
    this.started = false;
    window.removeEventListener("message", this.boundMessageHandler);
    if (this.unlistenMessagingStore) {
      this.unlistenMessagingStore();
      this.unlistenMessagingStore = null;
    }
    for (const pluginId of this.activeInstances.keys()) {
      this.teardownPlugin(pluginId);
    }
    this.activeInstances.clear();
  }

  async refreshDiscovery() {
    const localDescriptors = await discoverLocalPlugins();
    const allDescriptors = [...bundledPluginDescriptors, ...localDescriptors];

    const existingById = new Map(usePluginStore.getState().registry.map((item) => [item.manifest.id as string, item]));
    const desiredEnabled = { ...usePluginStore.getState().desiredEnabled };
    const nextRegistry: PluginRegistryItem[] = [];
    const seenIDs = new Set<string>();
    this.descriptors.clear();

    for (const rawDescriptor of allDescriptors) {
      const descriptor = { ...rawDescriptor };
      const validationError = validatePluginDescriptor(descriptor);
      const pluginId = String((descriptor.manifest as { id?: string }).id ?? "");
      if (pluginId.length === 0 || seenIDs.has(pluginId)) {
        continue;
      }
      seenIDs.add(pluginId);

      if (validationError) {
        nextRegistry.push({
          manifest: descriptor.manifest as PluginManifest,
          status: "failed",
          source: descriptor.source,
          sourceRef: descriptor.sourceRef,
          grantedPermissions: [],
          lastError: validationError.message,
          discoveredAt: nowISO(),
          updatedAt: nowISO(),
          commands: [],
          panels: [],
        });
        continue;
      }

      this.descriptors.set(pluginId, descriptor);

      const existing = existingById.get(pluginId);
      const shouldEnable = desiredEnabled[pluginId] === true;
      const status = existing?.status === "enabled" && shouldEnable ? "installed" : existing?.status ?? "discovered";

      nextRegistry.push({
        manifest: descriptor.manifest,
        status,
        source: descriptor.source,
        sourceRef: descriptor.sourceRef,
        grantedPermissions: existing?.grantedPermissions ?? [],
        lastError: existing?.lastError ?? null,
        discoveredAt: existing?.discoveredAt ?? nowISO(),
        updatedAt: nowISO(),
        commands: existing?.commands ?? [],
        panels: existing?.panels ?? [],
      });
    }

    usePluginStore.getState().setRegistry(nextRegistry);

    const stalePluginIDs = [...this.activeInstances.keys()].filter((pluginId) => !seenIDs.has(pluginId));
    for (const stalePluginID of stalePluginIDs) {
      this.teardownPlugin(stalePluginID);
    }

    for (const item of nextRegistry) {
      if (desiredEnabled[item.manifest.id as string]) {
        await this.enable(item.manifest.id as string);
      }
    }
  }

  async enable(pluginId: string) {
    const descriptor = this.descriptors.get(pluginId);
    if (!descriptor) {
      usePluginStore.getState().updatePluginStatus(pluginId, "failed", "plugin descriptor not found");
      return;
    }

    usePluginStore.getState().setDesiredEnabled(pluginId, true);

    for (const capability of descriptor.manifest.requestedPermissions) {
      if (!isCapabilityAllowedInV1(capability)) {
        usePluginStore.getState().updatePluginStatus(pluginId, "disabled", `permission denied for capability: ${capability}`);
        return;
      }
    }

    if (this.activeInstances.has(pluginId)) {
      usePluginStore.getState().updatePluginStatus(pluginId, "enabled", null);
      return;
    }

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.style.display = "none";
    const bootstrapToken = randomID();
    iframe.srcdoc = this.buildPluginSandboxDocument(descriptor, bootstrapToken);

    const instance = this.createActiveInstance(descriptor, iframe, bootstrapToken);
    this.activeInstances.set(pluginId, instance);

    const root = this.ensureSandboxRoot();
    root.appendChild(iframe);

    try {
      await this.awaitWithTimeout(instance.readyPromise, RUNTIME_READY_TIMEOUT_MS, "plugin runtime did not become ready");
      this.postToPlugin(instance, {
        kind: "host.init",
        pluginId,
        runtimeToken: instance.runtimeToken,
        grantedPermissions: descriptor.manifest.requestedPermissions,
      });
      await this.awaitWithTimeout(instance.initializedPromise, RUNTIME_INIT_TIMEOUT_MS, "plugin runtime init timed out");
      const existing = usePluginStore.getState().registry.find((item) => item.manifest.id === descriptor.manifest.id);
      if (existing) {
        usePluginStore.getState().upsertRegistryItem({
          ...existing,
          status: "enabled",
          grantedPermissions: [...descriptor.manifest.requestedPermissions],
          lastError: null,
          updatedAt: nowISO(),
        });
      } else {
        usePluginStore.getState().updatePluginStatus(pluginId, "enabled", null);
      }
      this.syncPluginRuntimeCollections(pluginId);
    } catch (error) {
      const message = error instanceof Error ? error.message : "plugin initialization failed";
      this.failPlugin(pluginId, message);
    }
  }

  disable(pluginId: string) {
    usePluginStore.getState().setDesiredEnabled(pluginId, false);
    this.teardownPlugin(pluginId);
    const current = usePluginStore.getState().registry.find((item) => String(item.manifest.id) === pluginId);
    if (current) {
      usePluginStore.getState().upsertRegistryItem({
        ...current,
        status: "disabled",
        grantedPermissions: [],
        lastError: null,
        updatedAt: nowISO(),
      });
    } else {
      usePluginStore.getState().updatePluginStatus(pluginId, "disabled", null);
    }
  }

  executeCommand(pluginId: string, commandId: string) {
    const instance = this.activeInstances.get(pluginId);
    if (!instance) {
      usePluginStore.getState().addNotice(pluginId, "Plugin is not enabled.");
      return;
    }

    this.postToPlugin(instance, {
      kind: "host.command.execute",
      pluginId,
      runtimeToken: instance.runtimeToken,
      commandId,
      triggeredAt: new Date().toISOString(),
    });

    this.emitEvent("command.executed", {
      pluginId,
      commandId,
      triggeredAt: new Date().toISOString(),
    });
  }

  install(pluginId: string) {
    const descriptor = this.descriptors.get(pluginId);
    if (!descriptor) {
      usePluginStore.getState().updatePluginStatus(pluginId, "failed", "plugin descriptor not found");
      return;
    }
    const current = usePluginStore.getState().registry.find((item) => item.manifest.id === descriptor.manifest.id);
    if (current) {
      usePluginStore.getState().upsertRegistryItem({
        ...current,
        status: "installed",
        lastError: null,
        updatedAt: nowISO(),
      });
      return;
    }
    usePluginStore.getState().updatePluginStatus(pluginId, "installed", null);
  }

  private ensureSandboxRoot() {
    const existing = document.getElementById(sandboxRootID);
    if (existing) {
      return existing;
    }
    const root = document.createElement("div");
    root.id = sandboxRootID;
    root.style.display = "none";
    document.body.appendChild(root);
    return root;
  }

  private buildPluginSandboxDocument(descriptor: LoadedPluginDescriptor, bootstrapToken: string): string {
    const sanitizedEntryCode = sanitizeForScript(descriptor.entrypointCode);
    const manifestJSON = JSON.stringify(descriptor.manifest);
    const safeBootstrapToken = sanitizeForScript(bootstrapToken);

    return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src data:; style-src 'unsafe-inline';" />
    <title>Plugin Sandbox</title>
  </head>
  <body>
    <script>${sanitizedEntryCode}</script>
    <script>
      (() => {
        const manifest = ${manifestJSON};
        const state = {
          pluginId: manifest.id,
          bootstrapToken: "${safeBootstrapToken}",
          runtimeToken: null,
          hostOrigin: "*",
          requestCounter: 0,
          pending: new Map(),
          commandHandlers: new Map(),
          eventHandlers: new Map(),
        };

        function send(message) {
          window.parent.postMessage(message, state.hostOrigin || "*");
        }

        function callHost(method, params) {
          if (!state.runtimeToken) {
            return Promise.reject(new Error("plugin runtime is not initialized"));
          }
          const requestId = String(++state.requestCounter) + "-" + Date.now();
          return new Promise((resolve, reject) => {
            state.pending.set(requestId, { resolve, reject });
            send({
              kind: "plugin.bridge.request",
              pluginId: state.pluginId,
              runtimeToken: state.runtimeToken,
              requestId,
              method,
              params: params || {},
            });
          });
        }

        function getHandlerSet(eventType) {
          if (!state.eventHandlers.has(eventType)) {
            state.eventHandlers.set(eventType, new Set());
          }
          return state.eventHandlers.get(eventType);
        }

        const api = {
          commands: {
            register: async (command) => {
              if (!command || typeof command.id !== "string" || typeof command.title !== "string") {
                throw new Error("invalid command registration payload");
              }
              if (typeof command.handler === "function") {
                state.commandHandlers.set(command.id, command.handler);
              }
              return callHost("registerCommand", { id: command.id, title: command.title });
            },
          },
          ui: {
            registerPanel: (panel) => callHost("registerPanel", panel),
            setPanelContent: (panelId, content) => callHost("setPanelContent", { id: panelId, content: String(content ?? "") }),
          },
          storage: {
            get: async (key) => {
              const response = await callHost("pluginStorage.get", { key });
              return response && typeof response.value === "string" ? response.value : null;
            },
            set: (key, value) => callHost("pluginStorage.set", { key, value }),
            delete: (key) => callHost("pluginStorage.delete", { key }),
            list: async () => {
              const response = await callHost("pluginStorage.list", {});
              return response && Array.isArray(response.keys) ? response.keys : [];
            },
          },
          messages: {
            getActiveConversationSummary: () => callHost("messages.getActiveConversationSummary", {}),
            getVisibleMessagesSanitized: () => callHost("messages.getVisibleMessagesSanitized", {}),
          },
          notifications: {
            showLocal: (message) => callHost("notifications.showLocal", { message: String(message ?? "") }),
          },
          events: {
            subscribe: async (eventType, handler) => {
              if (typeof eventType !== "string") {
                throw new Error("eventType must be a string");
              }
              if (typeof handler === "function") {
                getHandlerSet(eventType).add(handler);
              }
              return callHost("events.subscribe", { eventType });
            },
            unsubscribe: async (eventType, handler) => {
              if (typeof eventType !== "string") {
                throw new Error("eventType must be a string");
              }
              if (typeof handler === "function") {
                const set = getHandlerSet(eventType);
                set.delete(handler);
              }
              return callHost("events.unsubscribe", { eventType });
            },
          },
        };

        async function initializeRuntime() {
          try {
            const entry = window.__SECURE_MESSENGER_PLUGIN_ENTRY__;
            if (typeof entry !== "function") {
              throw new Error("window.__SECURE_MESSENGER_PLUGIN_ENTRY__ must be a function");
            }
            await entry(api);
            send({
              kind: "plugin.runtime.initialized",
              pluginId: state.pluginId,
              runtimeToken: state.runtimeToken,
              bootstrapToken: state.bootstrapToken,
            });
          } catch (error) {
            const message = error instanceof Error ? error.message : "plugin runtime init failure";
            send({
              kind: "plugin.runtime.error",
              pluginId: state.pluginId,
              runtimeToken: state.runtimeToken,
              bootstrapToken: state.bootstrapToken,
              message,
            });
          }
        }

        window.addEventListener("message", async (event) => {
          const data = event.data;
          if (!data || typeof data !== "object") {
            return;
          }

          if (data.kind === "host.init") {
            if (typeof data.runtimeToken !== "string" || data.runtimeToken.length < 12) {
              send({
                kind: "plugin.runtime.error",
                pluginId: state.pluginId,
                runtimeToken: state.runtimeToken,
                bootstrapToken: state.bootstrapToken,
                message: "invalid runtime token from host",
              });
              return;
            }
            state.runtimeToken = data.runtimeToken;
            state.hostOrigin = event.origin || "*";
            await initializeRuntime();
            return;
          }

          if (data.kind === "host.bridge.response") {
            if (data.runtimeToken !== state.runtimeToken) {
              send({
                kind: "plugin.runtime.error",
                pluginId: state.pluginId,
                runtimeToken: state.runtimeToken,
                bootstrapToken: state.bootstrapToken,
                message: "host bridge runtime token mismatch",
              });
              return;
            }
            const pending = state.pending.get(data.requestId);
            if (!pending) {
              return;
            }
            state.pending.delete(data.requestId);
            if (data.ok) {
              pending.resolve(data.result);
            } else {
              const message = data.error && data.error.message ? String(data.error.message) : "bridge request failed";
              pending.reject(new Error(message));
            }
            return;
          }

          if (data.kind === "host.event") {
            if (data.runtimeToken !== state.runtimeToken) {
              return;
            }
            const handlers = getHandlerSet(String(data.eventType || ""));
            for (const handler of handlers) {
              try {
                await handler({ eventType: data.eventType, payload: data.payload || {} });
              } catch (error) {
                const message = error instanceof Error ? error.message : "event handler failed";
                send({ kind: "plugin.runtime.error", pluginId: state.pluginId, bootstrapToken: state.bootstrapToken, message });
              }
            }
            return;
          }

          if (data.kind === "host.command.execute") {
            if (data.runtimeToken !== state.runtimeToken) {
              return;
            }
            const handler = state.commandHandlers.get(String(data.commandId || ""));
            if (typeof handler === "function") {
              try {
                await handler({ commandId: data.commandId, payload: data.payload || {} });
              } catch (error) {
                const message = error instanceof Error ? error.message : "command handler failed";
                send({ kind: "plugin.runtime.error", pluginId: state.pluginId, bootstrapToken: state.bootstrapToken, message });
              }
            }
          }
        });

        window.addEventListener("error", (event) => {
          send({
            kind: "plugin.runtime.error",
            pluginId: state.pluginId,
            runtimeToken: state.runtimeToken,
            bootstrapToken: state.bootstrapToken,
            message: event && event.message ? String(event.message) : "unhandled runtime error",
          });
        });

        send({ kind: "plugin.runtime.ready", pluginId: manifest.id, bootstrapToken: state.bootstrapToken });
      })();
    </script>
  </body>
</html>`;
  }

  private createActiveInstance(descriptor: LoadedPluginDescriptor, iframe: HTMLIFrameElement, bootstrapToken: string): ActivePluginInstance {
    let readyResolve: (() => void) | null = null;
    let initializedResolve: (() => void) | null = null;

    const readyPromise = new Promise<void>((resolve) => {
      readyResolve = resolve;
    });
    const initializedPromise = new Promise<void>((resolve) => {
      initializedResolve = resolve;
    });

    return {
      descriptor,
      iframe,
      bootstrapToken,
      runtimeToken: randomID(),
      grantedPermissions: new Set(descriptor.manifest.requestedPermissions),
      subscriptions: new Set(),
      commands: [],
      panels: [],
      readyResolve,
      readyPromise,
      initializedResolve,
      initializedPromise,
    };
  }

  private async awaitWithTimeout(promise: Promise<void>, timeoutMs: number, message: string) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const result = await Promise.race([promise.then(() => "done"), sleep(100).then(() => "wait")]);
      if (result === "done") {
        return;
      }
    }
    throw new Error(message);
  }

  private teardownPlugin(pluginId: string) {
    const instance = this.activeInstances.get(pluginId);
    if (!instance) {
      return;
    }
    if (instance.iframe.parentElement) {
      instance.iframe.parentElement.removeChild(instance.iframe);
    }
    this.activeInstances.delete(pluginId);
    usePluginStore.getState().clearPluginRuntimeState(pluginId);
  }

  private failPlugin(pluginId: string, message: string) {
    this.teardownPlugin(pluginId);
    usePluginStore.getState().updatePluginStatus(pluginId, "failed", message);
    usePluginStore.getState().addNotice(pluginId, `Plugin failed: ${message}`);
    logger.warn("plugin runtime moved plugin to failed state", { pluginId, message });
  }

  private postToPlugin(instance: ActivePluginInstance, payload: Record<string, unknown>) {
    instance.iframe.contentWindow?.postMessage(payload, "*");
  }

  private async handleWindowMessage(event: MessageEvent) {
    if (!event || !event.data || typeof event.data !== "object") {
      return;
    }

    const data = event.data as PluginRuntimeMessage;
    const instance = this.findInstanceForMessage(event.source, data);
    if (!instance) {
      return;
    }
    if (event.origin !== "null" && event.origin !== window.location.origin) {
      this.failPlugin(instance.descriptor.manifest.id as string, "plugin origin violation");
      return;
    }
    if ("pluginId" in data && data.pluginId && String(data.pluginId) !== String(instance.descriptor.manifest.id)) {
      this.failPlugin(instance.descriptor.manifest.id as string, "plugin id mismatch");
      return;
    }

    if (data.kind === "plugin.runtime.ready") {
      if (data.bootstrapToken !== instance.bootstrapToken) {
        this.failPlugin(instance.descriptor.manifest.id as string, "plugin bootstrap token mismatch");
        return;
      }
      instance.readyResolve?.();
      instance.readyResolve = null;
      return;
    }

    if (data.kind === "plugin.runtime.initialized") {
      if (data.bootstrapToken !== instance.bootstrapToken) {
        this.failPlugin(instance.descriptor.manifest.id as string, "plugin bootstrap token mismatch");
        return;
      }
      if (data.runtimeToken !== instance.runtimeToken) {
        this.failPlugin(instance.descriptor.manifest.id as string, "plugin runtime token mismatch");
        return;
      }
      instance.initializedResolve?.();
      instance.initializedResolve = null;
      return;
    }

    if (data.kind === "plugin.runtime.error") {
      if (data.bootstrapToken !== instance.bootstrapToken) {
        this.failPlugin(instance.descriptor.manifest.id as string, "plugin bootstrap token mismatch");
        return;
      }
      if (data.runtimeToken && data.runtimeToken !== instance.runtimeToken) {
        this.failPlugin(instance.descriptor.manifest.id as string, "plugin runtime token mismatch");
        return;
      }
      this.failPlugin(instance.descriptor.manifest.id as string, data.message || "plugin runtime error");
      return;
    }

    if (data.kind === "plugin.bridge.request") {
      const bridgeData = data as PluginBridgeRequestEnvelope & { runtimeToken?: string };
      if (bridgeData.runtimeToken !== instance.runtimeToken) {
        this.failPlugin(instance.descriptor.manifest.id as string, "plugin bridge token mismatch");
        return;
      }
      const response = await this.processBridgeRequest(instance, data);
      this.postToPlugin(instance, {
        kind: "host.bridge.response",
        runtimeToken: instance.runtimeToken,
        ...response,
      });
    }
  }

  private findInstanceForMessage(source: MessageEventSource | null, data: PluginRuntimeMessage): ActivePluginInstance | null {
    if (source && typeof source === "object") {
      for (const instance of this.activeInstances.values()) {
        if (instance.iframe.contentWindow === source) {
          return instance;
        }
      }
    }

    if (!("pluginId" in data) || !data.pluginId) {
      return null;
    }
    const candidate = this.activeInstances.get(String(data.pluginId));
    if (!candidate) {
      return null;
    }
    if ("bootstrapToken" in data && data.bootstrapToken && data.bootstrapToken !== candidate.bootstrapToken) {
      return null;
    }
    return candidate;
  }

  private async processBridgeRequest(
    instance: ActivePluginInstance,
    request: PluginBridgeRequestEnvelope,
  ): Promise<PluginBridgeResponse> {
    const pluginId = instance.descriptor.manifest.id;
    const denied = (message: string): PluginBridgeResponse => ({
      pluginId,
      requestId: request.requestId,
      ok: false,
      error: { code: "plugin_permission_denied", message },
    });
    const bridgeViolation = (message: string): PluginBridgeResponse => ({
      pluginId,
      requestId: request.requestId,
      ok: false,
      error: { code: "plugin_bridge_violation", message },
    });
    const ok = (result: unknown): PluginBridgeResponse => ({ pluginId, requestId: request.requestId, ok: true, result });

    if (String(request.pluginId) !== String(pluginId)) {
      return bridgeViolation("plugin id mismatch");
    }
    if (typeof request.requestId !== "string" || request.requestId.length === 0 || request.requestId.length > MAX_REQUEST_ID_LENGTH) {
      return bridgeViolation("invalid request id");
    }
    let encodedBytes = 0;
    try {
      encodedBytes = new TextEncoder().encode(JSON.stringify(request)).byteLength;
    } catch {
      return bridgeViolation("invalid bridge payload");
    }
    if (encodedBytes > MAX_BRIDGE_PAYLOAD_BYTES) {
      return bridgeViolation("bridge payload too large");
    }

    const requiredCapability = pluginCapabilityByMethod[request.method];
    if (!requiredCapability || !instance.grantedPermissions.has(requiredCapability)) {
      return denied(`missing capability '${requiredCapability ?? "unknown"}'`);
    }

    const params = request.params ?? {};
    try {
      switch (request.method) {
        case "registerCommand": {
          const id = typeof params.id === "string" ? params.id.trim() : "";
          const title = typeof params.title === "string" ? params.title.trim() : "";
          if (!id || !title || id.length > MAX_ID_LENGTH || !runtimeIDPattern.test(id)) {
            return bridgeViolation("invalid command registration payload");
          }
          const command: PluginCommandDTO = { pluginId, id: id as PluginCommandDTO["id"], title };
          instance.commands = [...instance.commands.filter((item) => item.id !== command.id), command];
          this.syncPluginRuntimeCollections(String(pluginId));
          return ok({ registered: true });
        }
        case "registerPanel": {
          const id = typeof params.id === "string" ? params.id.trim() : "";
          const title = typeof params.title === "string" ? params.title.trim() : "";
          if (!id || !title || id.length > MAX_ID_LENGTH || !runtimeIDPattern.test(id)) {
            return bridgeViolation("invalid panel registration payload");
          }
          const panel: PluginPanelDTO = { pluginId, id: id as PluginPanelDTO["id"], title, content: "" };
          instance.panels = [...instance.panels.filter((item) => item.id !== panel.id), panel];
          this.syncPluginRuntimeCollections(String(pluginId));
          return ok({ registered: true });
        }
        case "setPanelContent": {
          const id = typeof params.id === "string" ? params.id.trim() : "";
          const content = typeof params.content === "string" ? params.content : "";
          if (!id || id.length > MAX_ID_LENGTH || !runtimeIDPattern.test(id)) {
            return bridgeViolation("panel id is required");
          }
          const existing = instance.panels.find((item) => item.id === id);
          if (!existing) {
            return bridgeViolation("panel not registered");
          }
          const normalizedContent = content.slice(0, MAX_PANEL_CONTENT_LENGTH);
          const contentSize = new TextEncoder().encode(normalizedContent).byteLength;
          if (contentSize > MAX_BRIDGE_PAYLOAD_BYTES) {
            return bridgeViolation("panel content is too large");
          }
          const updatedPanel: PluginPanelDTO = { ...existing, content: normalizedContent };
          instance.panels = [...instance.panels.filter((item) => item.id !== id), updatedPanel];
          usePluginStore.getState().upsertPluginPanel(updatedPanel);
          return ok({ updated: true });
        }
        case "pluginStorage.get": {
          const key = typeof params.key === "string" ? params.key.trim() : "";
          if (!key || !storageKeyPattern.test(key)) {
            return bridgeViolation("storage key is required");
          }
          const value = localStorage.getItem(this.pluginStorageKey(String(pluginId), key));
          return ok({ value });
        }
        case "pluginStorage.set": {
          const key = typeof params.key === "string" ? params.key.trim() : "";
          const value = typeof params.value === "string" ? params.value : String(params.value ?? "");
          if (!key || !storageKeyPattern.test(key)) {
            return bridgeViolation("storage key is required");
          }
          localStorage.setItem(this.pluginStorageKey(String(pluginId), key), value.slice(0, MAX_STORAGE_VALUE_BYTES));
          return ok({ stored: true });
        }
        case "pluginStorage.delete": {
          const key = typeof params.key === "string" ? params.key.trim() : "";
          if (!key || !storageKeyPattern.test(key)) {
            return bridgeViolation("storage key is required");
          }
          localStorage.removeItem(this.pluginStorageKey(String(pluginId), key));
          return ok({ deleted: true });
        }
        case "pluginStorage.list": {
          const prefix = `plugin-local:${pluginId}:`;
          const keys: string[] = [];
          for (let index = 0; index < localStorage.length; index += 1) {
            const fullKey = localStorage.key(index);
            if (!fullKey || !fullKey.startsWith(prefix)) {
              continue;
            }
            const key = fullKey.slice(prefix.length);
            if (!storageKeyPattern.test(key)) {
              continue;
            }
            keys.push(key);
            if (keys.length >= 512) {
              break;
            }
          }
          return ok({ keys });
        }
        case "messages.getActiveConversationSummary": {
          const state = useMessagingStore.getState();
          const activeConversation = state.conversations.find((item) => item.id === state.activeConversationId);
          if (!activeConversation) {
            return ok(null);
          }
          return ok({
            id: activeConversation.id,
            title: activeConversation.title,
            type: activeConversation.type,
            memberCount: activeConversation.members.length,
            lastServerSequence: activeConversation.lastServerSequence,
            updatedAt: activeConversation.updatedAt,
          });
        }
        case "messages.getVisibleMessagesSanitized": {
          const state = useMessagingStore.getState();
          const conversationId = state.activeConversationId;
          if (!conversationId) {
            return ok([]);
          }
          const messages = state.messagesByConversation[conversationId] ?? [];
          const sanitized = messages.map((message) => ({
            id: message.envelope.id,
            conversationId: message.envelope.conversationId,
            senderAccountId: message.envelope.senderAccountId,
            senderDeviceId: message.envelope.senderDeviceId,
            clientMessageId: message.envelope.clientMessageId,
            createdAt: message.envelope.createdAt,
            expiresAt: message.envelope.expiresAt,
            serverSequence: message.envelope.serverSequence,
            deliveryState: message.deliveryState,
            lifecycle: message.lifecycle,
            expired: message.expired ?? false,
            text: message.plaintext?.text ?? null,
            attachments:
              message.plaintext?.attachments?.map((attachment) => ({
                attachmentId: attachment.attachmentId,
                fileName: attachment.fileName,
                mimeType: attachment.mimeType,
                sizeBytes: attachment.sizeBytes,
              })) ?? [],
          }));
          return ok(sanitized);
        }
        case "events.subscribe": {
          const eventType = typeof params.eventType === "string" ? params.eventType : "";
          if (!allowedEventTypes.has(eventType as RuntimeEventType)) {
            return bridgeViolation("unsupported event type");
          }
          if (!instance.descriptor.manifest.declaredHooks.includes(eventType as RuntimeEventType)) {
            return denied(`event '${eventType}' is not declared in manifest`);
          }
          instance.subscriptions.add(eventType as RuntimeEventType);
          return ok({ subscribed: true });
        }
        case "events.unsubscribe": {
          const eventType = typeof params.eventType === "string" ? params.eventType : "";
          if (!allowedEventTypes.has(eventType as RuntimeEventType)) {
            return bridgeViolation("unsupported event type");
          }
          instance.subscriptions.delete(eventType as RuntimeEventType);
          return ok({ unsubscribed: true });
        }
        case "notifications.showLocal": {
          const message = typeof params.message === "string" ? params.message.trim() : "";
          if (!message) {
            return bridgeViolation("notification message is required");
          }
          usePluginStore.getState().addNotice(String(pluginId), message.slice(0, 280));
          return ok({ shown: true });
        }
        default:
          return bridgeViolation("unsupported bridge method");
      }
    } catch (error) {
      logger.warn("plugin bridge request failed", {
        pluginId: String(pluginId),
        method: request.method,
        error: String(error),
      });
      return {
        pluginId,
        requestId: request.requestId,
        ok: false,
        error: { code: "plugin_storage_unavailable", message: "bridge request failed" },
      };
    }
  }

  private pluginStorageKey(pluginId: string, key: string): string {
    return `plugin-local:${pluginId}:${key}`;
  }

  private syncPluginRuntimeCollections(pluginId: string) {
    const instance = this.activeInstances.get(pluginId);
    if (!instance) {
      return;
    }
    usePluginStore.getState().replacePluginCommands(pluginId, instance.commands);
    usePluginStore.getState().replacePluginPanels(pluginId, instance.panels);
  }

  private attachMessagingSubscriptions() {
    if (this.unlistenMessagingStore) {
      return;
    }

    this.unlistenMessagingStore = useMessagingStore.subscribe((state) => {
      const transport = `${state.transport.mode}:${state.transport.status}:${state.transport.endpoint ?? ""}`;
      if (transport !== this.transportSnapshot) {
        this.transportSnapshot = transport;
        this.emitEvent("transport.state.changed", {
          mode: state.transport.mode,
          status: state.transport.status,
          endpoint: state.transport.endpoint,
          lastError: state.transport.lastError,
        });
      }

      const activeConversation = state.conversations.find((item) => item.id === state.activeConversationId);
      const activeSnapshot = activeConversation
        ? `${activeConversation.id}:${activeConversation.updatedAt}:${activeConversation.lastServerSequence}`
        : "";
      if (activeSnapshot !== this.activeConversationSnapshot) {
        this.activeConversationSnapshot = activeSnapshot;
        this.emitEvent("conversation.changed", {
          conversationId: activeConversation?.id ?? null,
          title: activeConversation?.title ?? null,
          type: activeConversation?.type ?? null,
          memberCount: activeConversation?.members.length ?? 0,
        });
      }

      if (state.activeConversationId) {
        const messages = state.messagesByConversation[state.activeConversationId] ?? [];
        const latest = messages.length > 0 ? messages[messages.length - 1] : null;
        const visibleSnapshot = `${state.activeConversationId}:${messages.length}:${latest?.envelope.id ?? ""}:${latest?.lastUpdatedAt ?? ""}`;
        if (visibleSnapshot !== this.visibleMessageSnapshot) {
          this.visibleMessageSnapshot = visibleSnapshot;
          this.emitEvent("message.visible", {
            conversationId: state.activeConversationId,
            count: messages.length,
            latestMessageId: latest?.envelope.id ?? null,
          });
        }
      }
    });
  }

  private emitEvent(eventType: RuntimeEventType, payload: Record<string, unknown>) {
    const eventEnvelope: PluginEventPayload = {
      id: randomID() as PluginEventPayload["id"],
      pluginId: "host.runtime" as PluginEventPayload["pluginId"],
      eventType,
      payload,
      createdAt: new Date().toISOString() as PluginEventPayload["createdAt"],
    };

    for (const instance of this.activeInstances.values()) {
      if (!instance.subscriptions.has(eventType)) {
        continue;
      }
      this.postToPlugin(instance, {
        kind: "host.event",
        runtimeToken: instance.runtimeToken,
        eventType: eventEnvelope.eventType,
        payload: eventEnvelope.payload,
        createdAt: eventEnvelope.createdAt,
      });
    }
  }
}

export const pluginRuntime = new PluginRuntime();
