import { FormEvent, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import {
  ServerConnectionError,
  connectToServer,
  getServerInputDefaultValue,
} from "@/services/serverConnection";

export function ServerConnectPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const defaultValue = useMemo(() => getServerInputDefaultValue(), []);
  const [address, setAddress] = useState(defaultValue);
  const [isConnecting, setIsConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsConnecting(true);

    try {
      await connectToServer(address);
      navigate("/auth/login", { replace: true });
    } catch (connectError) {
      if (connectError instanceof ServerConnectionError) {
        if (connectError.code === "invalid_input") {
          setError(t("serverConnect.invalidInput"));
        } else if (connectError.code === "config_invalid") {
          setError(t("serverConnect.invalidConfig"));
        } else {
          setError(t("serverConnect.connectionFailed"));
        }
      } else {
        setError(t("serverConnect.connectionFailed"));
      }
    } finally {
      setIsConnecting(false);
    }
  }

  return (
    <section className="form-shell page-stack">
      <h1>{t("serverConnect.title")}</h1>
      <p className="text-muted">{t("serverConnect.subtitle")}</p>

      <form className="form-grid" onSubmit={handleSubmit}>
        <label>
          {t("serverConnect.serverAddress")}
          <input
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={t("serverConnect.placeholder")}
            autoFocus
            required
          />
        </label>

        {error ? <p className="error-text">{error}</p> : null}

        <button type="submit" disabled={isConnecting || !address.trim()}>
          {isConnecting ? t("serverConnect.connecting") : t("serverConnect.connect")}
        </button>
      </form>
    </section>
  );
}
