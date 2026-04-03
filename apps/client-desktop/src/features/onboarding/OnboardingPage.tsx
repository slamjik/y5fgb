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
    <section className="page-stack">
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

      <div className="card-grid">
        <article className="card">
          <h2>{t("onboarding.serverConnectTitle")}</h2>
          <p className="text-muted">{t("onboarding.serverConnectHint")}</p>
          <ol className="checklist">
            <li>{t("onboarding.serverConnectStepInput")}</li>
            <li>{t("onboarding.serverConnectStepResolve")}</li>
            <li>{t("onboarding.serverConnectStepFallback")}</li>
          </ol>
        </article>

        <article className="card">
          <h2>{t("onboarding.twoFATitle")}</h2>
          <p className="text-muted">{t("onboarding.twoFAHint")}</p>
          <ol className="checklist">
            <li>{t("onboarding.twoFAStepStart")}</li>
            <li>{t("onboarding.twoFAStepConfirm")}</li>
            <li>{t("onboarding.twoFAStepRecovery")}</li>
          </ol>
          <div className="inline-actions section-offset-sm">
            <Link className="button-link" to="/devices">
              {t("onboarding.openDevices")}
            </Link>
          </div>
        </article>
      </div>

      <div className="inline-actions section-offset-sm">
        <button type="button" onClick={finishOnboarding}>
          {t("onboarding.complete")}
        </button>
        {onboardingCompleted ? <span className="text-muted">{t("onboarding.alreadyDone")}</span> : null}
      </div>
    </section>
  );
}
