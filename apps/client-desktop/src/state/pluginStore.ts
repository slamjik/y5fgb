import type { PluginCommandDTO, PluginPanelDTO, PluginRegistryItem } from "@project/protocol";
import type { PluginStatus } from "@project/shared-types";
import { create } from "zustand";
import { persist } from "zustand/middleware";

type PluginNotice = {
  id: string;
  pluginId: string;
  message: string;
  createdAt: string;
};

interface PluginStore {
  registry: PluginRegistryItem[];
  commands: PluginCommandDTO[];
  panels: PluginPanelDTO[];
  notices: PluginNotice[];
  desiredEnabled: Record<string, boolean>;
  setRegistry: (items: PluginRegistryItem[]) => void;
  upsertRegistryItem: (item: PluginRegistryItem) => void;
  updatePluginStatus: (pluginId: string, status: PluginStatus, lastError?: string | null) => void;
  setDesiredEnabled: (pluginId: string, enabled: boolean) => void;
  replacePluginCommands: (pluginId: string, commands: PluginCommandDTO[]) => void;
  replacePluginPanels: (pluginId: string, panels: PluginPanelDTO[]) => void;
  upsertPluginPanel: (panel: PluginPanelDTO) => void;
  addNotice: (pluginId: string, message: string) => void;
  clearPluginRuntimeState: (pluginId: string) => void;
}

export const usePluginStore = create<PluginStore>()(
  persist(
    (set, get) => ({
      registry: [],
      commands: [],
      panels: [],
      notices: [],
      desiredEnabled: {},
      setRegistry: (items) => set({ registry: items }),
      upsertRegistryItem: (item) =>
        set((state) => {
          const existingIndex = state.registry.findIndex((current) => current.manifest.id === item.manifest.id);
          if (existingIndex === -1) {
            return { registry: [...state.registry, item] };
          }
          const next = [...state.registry];
          next[existingIndex] = item;
          return { registry: next };
        }),
      updatePluginStatus: (pluginId, status, lastError = null) =>
        set((state) => ({
          registry: state.registry.map((item) =>
            item.manifest.id === pluginId
              ? {
                  ...item,
                  status,
                  lastError,
                  updatedAt: new Date().toISOString() as PluginRegistryItem["updatedAt"],
                }
              : item,
          ),
        })),
      setDesiredEnabled: (pluginId, enabled) =>
        set((state) => ({
          desiredEnabled: {
            ...state.desiredEnabled,
            [pluginId]: enabled,
          },
        })),
      replacePluginCommands: (pluginId, commands) =>
        set((state) => ({
          commands: [...state.commands.filter((item) => item.pluginId !== pluginId), ...commands],
          registry: state.registry.map((item) =>
            item.manifest.id === pluginId
              ? {
                  ...item,
                  commands,
                  updatedAt: new Date().toISOString() as PluginRegistryItem["updatedAt"],
                }
              : item,
          ),
        })),
      replacePluginPanels: (pluginId, panels) =>
        set((state) => ({
          panels: [...state.panels.filter((item) => item.pluginId !== pluginId), ...panels],
          registry: state.registry.map((item) =>
            item.manifest.id === pluginId
              ? {
                  ...item,
                  panels,
                  updatedAt: new Date().toISOString() as PluginRegistryItem["updatedAt"],
                }
              : item,
          ),
        })),
      upsertPluginPanel: (panel) =>
        set((state) => {
          const existingIndex = state.panels.findIndex((item) => item.pluginId === panel.pluginId && item.id === panel.id);
          if (existingIndex === -1) {
            return { panels: [...state.panels, panel] };
          }
          const next = [...state.panels];
          next[existingIndex] = panel;
          return {
            panels: next,
            registry: state.registry.map((item) =>
              item.manifest.id === panel.pluginId
                ? {
                    ...item,
                    panels: [...item.panels.filter((currentPanel) => currentPanel.id !== panel.id), panel],
                    updatedAt: new Date().toISOString() as PluginRegistryItem["updatedAt"],
                  }
                : item,
            ),
          };
        }),
      addNotice: (pluginId, message) =>
        set((state) => ({
          notices: [
            {
              id: crypto.randomUUID(),
              pluginId,
              message,
              createdAt: new Date().toISOString(),
            },
            ...state.notices,
          ].slice(0, 100),
        })),
      clearPluginRuntimeState: (pluginId) => {
        const currentRegistryItem = get().registry.find((item) => item.manifest.id === pluginId);
        set((state) => ({
          commands: state.commands.filter((item) => item.pluginId !== pluginId),
          panels: state.panels.filter((item) => item.pluginId !== pluginId),
          registry: state.registry.map((item) =>
            item.manifest.id !== pluginId
              ? item
              : {
                  ...item,
                  commands: [],
                  panels: [],
                  status: currentRegistryItem?.status ?? item.status,
                },
          ),
        }));
      },
    }),
    {
      name: "secure-messenger-plugin-state",
      partialize: (state) => ({
        desiredEnabled: state.desiredEnabled,
      }),
    },
  ),
);
