import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { authApi } from "@/services/authApi";
import { applySessionEnvelope } from "@/services/authSession";
import { useAuthStore } from "@/state/authStore";

export function TwoFAVerifyPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const challenge = useAuthStore((state) => state.twoFAChallenge);
  const setTwoFAChallenge = useAuthStore((state) => state.setTwoFAChallenge);
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!challenge) {
    return <Navigate to="/auth/login" replace />;
  }
  const currentChallenge = challenge;

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const result = await authApi.verifyTwoFALogin({
        challengeId: currentChallenge.challengeId,
        loginToken: currentChallenge.loginToken,
        code,
      });
      await applySessionEnvelope(result);
      setTwoFAChallenge(null);
      navigate("/devices", { replace: true });
    } catch (submitError) {
      setError(extractApiErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="form-shell">
      <h1>{t("auth.twoFactorTitle")}</h1>
      <p className="text-muted">{t("auth.twoFactorSubtitle")}</p>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          {t("auth.code")}
          <input value={code} onChange={(event) => setCode(event.target.value)} required />
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? t("auth.verifyLoading") : t("auth.verifyAction")}
        </button>
      </form>
    </section>
  );
}

