import { useTranslation } from "react-i18next";
import { Link, useNavigate } from "react-router-dom";

import { useAppStore } from "@/state/appStore";

export function OnboardingPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const onboardingCompleted = useAppStore((state) => state.onboardingCompleted);
  const setOnboardingCompleted = useAppStore((state) => state.setOnboardingCompleted);

  function finishOnboarding() {
    setOnboardingCompleted(true);
    navigate("/", { replace: true });
  }

  return (
    <section>
      <h1>{t("onboarding.title")}</h1>
      <p className="text-muted">{t("onboarding.subtitle")}</p>

      <article className="card">
        <h2>{t("onboarding.checklistTitle")}</h2>
        <ol className="checklist">
          <li>{t("onboarding.stepTrust")}</li>
          <li>{t("onboarding.stepMessaging")}</li>
          <li>{t("onboarding.stepFallback")}</li>
          <li>{t("onboarding.stepPlugins")}</li>
        </ol>
        <div className="inline-actions">
          <Link className="button-link" to="/devices">
            {t("onboarding.openDevices")}
          </Link>
          <Link className="button-link" to="/">
            {t("onboarding.openConversations")}
          </Link>
          <Link className="button-link" to="/messaging/transport">
            {t("onboarding.openTransport")}
          </Link>
          <Link className="button-link" to="/plugins">
            {t("onboarding.openPlugins")}
          </Link>
        </div>
      </article>

      <div className="inline-actions" style={{ marginTop: 12 }}>
        <button type="button" onClick={finishOnboarding}>
          {t("onboarding.complete")}
        </button>
        {onboardingCompleted ? <span className="text-muted">{t("onboarding.alreadyDone")}</span> : null}
      </div>
    </section>
  );
}

