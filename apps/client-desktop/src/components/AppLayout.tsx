import { useTranslation } from "react-i18next";
import { Link, Outlet, useLocation } from "react-router-dom";

import { Sidebar } from "@/components/Sidebar";
import { updaterService } from "@/services/updater";
import { useUpdaterStore } from "@/state/updaterStore";

export function AppLayout() {
  const location = useLocation();
  const { t } = useTranslation();
  const bannerVisible = useUpdaterStore((state) => state.bannerVisible);
  const availableVersion = useUpdaterStore((state) => state.availableVersion);

  return (
    <div className="app-shell">
      <Sidebar />
      <main className="app-main">
        <div className="app-main-inner">
          {bannerVisible && availableVersion ? (
            <section className="update-banner" role="status" aria-live="polite">
              <div>
                <strong>{t("updates.bannerTitle")}</strong>
                <p className="text-muted">{t("updates.bannerBody", { version: availableVersion })}</p>
              </div>
              <div className="inline-actions">
                <Link className="button-link" to="/settings#updates">
                  {t("updates.openUpdater")}
                </Link>
                <button type="button" className="button-ghost" onClick={() => updaterService.dismissUpdateBanner()}>
                  {t("updates.dismiss")}
                </button>
              </div>
            </section>
          ) : null}

          <section className="page-transition" key={location.pathname}>
            <Outlet />
          </section>
        </div>
      </main>
    </div>
  );
}
