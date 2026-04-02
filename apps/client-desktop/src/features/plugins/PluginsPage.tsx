import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { pluginRuntime } from "@/services/plugins/runtime";
import { usePluginStore } from "@/state/pluginStore";

export function PluginsPage() {
  const { t } = useTranslation();
  const registry = usePluginStore((state) => state.registry);
  const commands = usePluginStore((state) => state.commands);
  const notices = usePluginStore((state) => state.notices);

  const [busyPluginId, setBusyPluginId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const sortedRegistry = useMemo(() => [...registry].sort((left, right) => left.manifest.name.localeCompare(right.manifest.name)), [registry]);

  async function refresh() {
    setRefreshing(true);
    try {
      await pluginRuntime.refreshDiscovery();
    } finally {
      setRefreshing(false);
    }
  }

  async function enable(pluginId: string) {
    setBusyPluginId(pluginId);
    try {
      await pluginRuntime.enable(pluginId);
    } finally {
      setBusyPluginId(null);
    }
  }

  function disable(pluginId: string) {
    setBusyPluginId(pluginId);
    try {
      pluginRuntime.disable(pluginId);
    } finally {
      setBusyPluginId(null);
    }
  }

  return (
    <section>
      <h1>{t("plugins.title")}</h1>
      <p className="text-muted">{t("plugins.subtitle")}</p>

      <div className="inline-actions" style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => void refresh()} disabled={refreshing}>
          {refreshing ? t("plugins.refreshing") : t("plugins.discover")}
        </button>
      </div>

      {sortedRegistry.length === 0 ? <p className="text-muted">{t("plugins.noPlugins")}</p> : null}

      <div className="card-grid">
        {sortedRegistry.map((plugin) => {
          const isBusy = busyPluginId === plugin.manifest.id;
          const isEnabled = plugin.status === "enabled";
          return (
            <article key={plugin.manifest.id} className="card">
              <h2>{plugin.manifest.name}</h2>
              <p className="text-muted">
                <code>{plugin.manifest.id}</code> | v{plugin.manifest.version}
              </p>
              <p className="text-muted">
                {t("plugins.source")}: {plugin.source} ({plugin.sourceRef})
              </p>
              <p>
                {t("common.status")}: <span className={`status-chip status-${mapPluginStatus(plugin.status)}`}>{plugin.status}</span>
              </p>
              {plugin.lastError ? <p className="error-text">{plugin.lastError}</p> : null}

              <p className="text-muted">{t("plugins.requestedPermissions")}:</p>
              {plugin.manifest.requestedPermissions.length === 0 ? (
                <p className="text-muted">{t("common.none")}</p>
              ) : (
                <div>
                  {plugin.manifest.requestedPermissions.map((permission) => (
                    <span key={`${plugin.manifest.id}-${permission}`} className="inline-code">
                      {permission}
                    </span>
                  ))}
                </div>
              )}

              <p className="text-muted">{t("plugins.panels")}:</p>
              {plugin.manifest.uiContributions.panels.length === 0 ? (
                <p className="text-muted">{t("common.none")}</p>
              ) : (
                <div className="inline-actions">
                  {plugin.manifest.uiContributions.panels.map((panel) => (
                    <Link key={`${plugin.manifest.id}-${panel.id}`} className="button-link" to={`/plugins/panels/${plugin.manifest.id}/${panel.id}`}>
                      {panel.title}
                    </Link>
                  ))}
                </div>
              )}

              <div className="inline-actions" style={{ marginTop: 12 }}>
                {plugin.status === "discovered" ? (
                  <button type="button" onClick={() => pluginRuntime.install(String(plugin.manifest.id))} disabled={isBusy}>
                    {t("plugins.install")}
                  </button>
                ) : null}
                {isEnabled ? (
                  <button type="button" onClick={() => disable(plugin.manifest.id)} disabled={isBusy}>
                    {t("plugins.disable")}
                  </button>
                ) : (
                  <button type="button" onClick={() => void enable(plugin.manifest.id)} disabled={isBusy || plugin.status === "discovered"}>
                    {t("plugins.enable")}
                  </button>
                )}
              </div>
            </article>
          );
        })}
      </div>

      <section style={{ marginTop: 18 }}>
        <h2>{t("plugins.commandsTitle")}</h2>
        {commands.length === 0 ? <p className="text-muted">{t("plugins.noCommands")}</p> : null}
        {commands.map((command) => (
          <div key={`${command.pluginId}-${command.id}`} className="list-item">
            <p>
              <strong>{command.title}</strong>
            </p>
            <p className="text-muted">
              Plugin: <code>{command.pluginId}</code> | Command: <code>{command.id}</code>
            </p>
            <button type="button" onClick={() => pluginRuntime.executeCommand(String(command.pluginId), String(command.id))}>
              {t("plugins.runCommand")}
            </button>
          </div>
        ))}
      </section>

      <section style={{ marginTop: 18 }}>
        <h2>{t("plugins.noticesTitle")}</h2>
        {notices.length === 0 ? <p className="text-muted">{t("plugins.noNotices")}</p> : null}
        {notices.slice(0, 20).map((notice) => (
          <div key={notice.id} className="list-item">
            <p>{notice.message}</p>
            <p className="text-muted">
              Plugin: <code>{notice.pluginId}</code> | {notice.createdAt}
            </p>
          </div>
        ))}
      </section>
    </section>
  );
}

function mapPluginStatus(status: string) {
  switch (status) {
    case "enabled":
      return "delivered";
    case "failed":
      return "failed";
    case "disabled":
      return "queued";
    default:
      return "sent";
  }
}

