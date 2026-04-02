import { FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { extractApiErrorMessage } from "@/services/apiClient";
import { authApi } from "@/services/authApi";
import { applySessionEnvelope } from "@/services/authSession";
import { createAccountIdentity, loadOrCreateDeviceIdentity } from "@/services/identity";

function defaultDeviceName() {
  const platform = navigator.platform || "desktop";
  return `My ${platform}`;
}

export function RegisterPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
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
      const accountIdentity = await createAccountIdentity();
      const deviceIdentity = await loadOrCreateDeviceIdentity(deviceName);

      const response = await authApi.register({
        email,
        password,
        accountIdentityMaterial: accountIdentity.publicMaterial,
        accountIdentityFingerprint: accountIdentity.fingerprint,
        device: {
          deviceId: deviceIdentity.deviceId,
          name: deviceIdentity.deviceName,
          platform,
          publicDeviceMaterial: deviceIdentity.publicMaterial,
          fingerprint: deviceIdentity.fingerprint,
        },
      });

      await applySessionEnvelope(response);
      navigate("/devices", { replace: true });
    } catch (submitError) {
      setError(extractApiErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="form-shell page-stack">
      <h1>{t("auth.createAccount")}</h1>
      <p className="text-muted">{t("auth.createAccountSubtitle")}</p>
      <form className="form-grid" onSubmit={onSubmit}>
        <label>
          {t("auth.email")}
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>

        <label>
          {t("auth.password")}
          <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" minLength={10} required />
        </label>

        <label>
          {t("auth.deviceName")}
          <input value={deviceName} onChange={(event) => setDeviceName(event.target.value)} required />
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button disabled={isSubmitting} type="submit">
          {isSubmitting ? t("auth.registerLoading") : t("auth.registerAction")}
        </button>
      </form>
    </section>
  );
}
