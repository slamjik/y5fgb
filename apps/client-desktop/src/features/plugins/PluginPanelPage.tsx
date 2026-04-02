import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { usePluginStore } from "@/state/pluginStore";

export function PluginPanelPage() {
  const { t } = useTranslation();
  const { pluginId = "", panelId = "" } = useParams();
  const panel = usePluginStore((state) => state.panels.find((item) => String(item.pluginId) === pluginId && String(item.id) === panelId));
  const plugin = usePluginStore((state) => state.registry.find((item) => String(item.manifest.id) === pluginId));

  const headerTitle = useMemo(() => panel?.title ?? plugin?.manifest.name ?? "Plugin Panel", [panel?.title, plugin?.manifest.name]);

  return (
    <section>
      <h1>{headerTitle}</h1>
      <p className="text-muted">
        Plugin: <code>{pluginId}</code> | Panel: <code>{panelId}</code>
      </p>
      <div className="inline-actions" style={{ marginBottom: 12 }}>
        <Link className="button-link" to="/plugins">
          {t("plugins.backToPlugins")}
        </Link>
      </div>

      {!panel ? (
        <p className="text-muted">{t("plugins.panelUnavailable")}</p>
      ) : (
        <article className="card">
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{panel.content || "No panel content yet."}</pre>
        </article>
      )}
    </section>
  );
}

