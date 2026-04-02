import { FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { authApi } from "@/services/authApi";
import { applySessionEnvelope } from "@/services/authSession";
import { loadOrCreateDeviceIdentity } from "@/services/identity";
import { useAuthStore } from "@/state/authStore";

function defaultDeviceName() {
  const platform = navigator.platform || "desktop";
  return `My ${platform}`;
}

export function LoginPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const setPendingApproval = useAuthStore((state) => state.setPendingApproval);
  const setTwoFAChallenge = useAuthStore((state) => state.setTwoFAChallenge);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [deviceName, setDeviceName] = useState(defaultDeviceName());
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const platform = useMemo(() => navigator.userAgent, []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      const deviceIdentity = await loadOrCreateDeviceIdentity(deviceName);
      const outcome = await authApi.login({
        email,
        password,
        device: {
          deviceId: deviceIdentity.deviceId,
          name: deviceIdentity.deviceName,
          platform,
          publicDeviceMaterial: deviceIdentity.publicMaterial,
          fingerprint: deviceIdentity.fingerprint,
        },
      });

      if (outcome.kind === "pending") {
        setPendingApproval(outcome.data);
        navigate("/pending-approval", { replace: true });
        return;
      }

      if (outcome.kind === "two_fa") {
        setTwoFAChallenge(outcome.data);
        navigate("/auth/2fa", { replace: true });
        return;
      }

      await applySessionEnvelope(outcome.data);
      navigate("/devices", { replace: true });
    } catch (submitError) {
      setError(extractApiErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="form-shell page-stack">
      <h1>{t("auth.signIn")}</h1>
      <p className="text-muted">{t("auth.signInSubtitle")}</p>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          {t("auth.email")}
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>

        <label>
          {t("auth.password")}
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" required />
        </label>

        <label>
          {t("auth.deviceName")}
          <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required />
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? t("auth.loginLoading") : t("auth.loginAction")}
        </button>
      </form>
    </section>
  );
}
