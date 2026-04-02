import type { DeviceListResponse } from "@project/protocol";
import { FormEvent, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { extractApiErrorMessage } from "@/services/apiClient";
import { authApi } from "@/services/authApi";
import { clearSession } from "@/services/authSession";
import { devicesApi } from "@/services/devicesApi";
import { commitDeviceIdentityRotation, generateDeviceIdentityCandidate } from "@/services/identity";
import { useAuthStore } from "@/state/authStore";

export function DevicesPage() {
  const { t } = useTranslation();
  const accessToken = useAuthStore((state) => state.accessToken);
  const session = useAuthStore((state) => state.session);
  const recoveryCodes = useAuthStore((state) => state.recoveryCodes);
  const setRecoveryCodes = useAuthStore((state) => state.setRecoveryCodes);
  const updateSessionDetails = useAuthStore((state) => state.updateSessionDetails);

  const [data, setData] = useState<DeviceListResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [setupSecret, setSetupSecret] = useState<string | null>(null);
  const [setupProvisioningUri, setSetupProvisioningUri] = useState<string | null>(null);
  const [setupConfirmCode, setSetupConfirmCode] = useState("");
  const [disableCode, setDisableCode] = useState("");
  const [rotatingKey, setRotatingKey] = useState(false);
  const [logoutAllRunning, setLogoutAllRunning] = useState(false);

  useEffect(() => {
    if (!accessToken) {
      return;
    }

    void refreshList();
  }, [accessToken]);

  async function refreshList() {
    if (!accessToken) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const list = await devicesApi.list(accessToken);
      setData(list);
      const details = await authApi.session(accessToken);
      updateSessionDetails({
        email: details.email,
        twoFactorEnabled: details.twoFactorEnabled,
        identity: details.identity,
        device: details.device,
        session: details.session,
      });
    } catch (listError) {
      setError(extractApiErrorMessage(listError));
    } finally {
      setLoading(false);
    }
  }

  async function approve(approvalRequestId: string) {
    if (!accessToken) {
      return;
    }

    try {
      await devicesApi.approve(accessToken, approvalRequestId, twoFactorCode || undefined);
      await refreshList();
    } catch (approveError) {
      setError(extractApiErrorMessage(approveError));
    }
  }

  async function reject(approvalRequestId: string) {
    if (!accessToken) {
      return;
    }

    try {
      await devicesApi.reject(accessToken, approvalRequestId, twoFactorCode || undefined);
      await refreshList();
    } catch (rejectError) {
      setError(extractApiErrorMessage(rejectError));
    }
  }

  async function revoke(deviceId: string) {
    if (!accessToken) {
      return;
    }

    try {
      await devicesApi.revoke(accessToken, deviceId, twoFactorCode || undefined);
      await refreshList();
    } catch (revokeError) {
      setError(extractApiErrorMessage(revokeError));
    }
  }

  async function rotateCurrentDeviceKey() {
    if (!accessToken || !session) {
      return;
    }

    setRotatingKey(true);
    setError(null);

    try {
      const candidate = await generateDeviceIdentityCandidate();
      await devicesApi.rotateKey(accessToken, {
        publicDeviceMaterial: candidate.publicMaterial,
        fingerprint: candidate.fingerprint,
        twoFactorCode: twoFactorCode || undefined,
      });
      await commitDeviceIdentityRotation(candidate);
      await refreshList();
    } catch (rotateError) {
      setError(extractApiErrorMessage(rotateError));
    } finally {
      setRotatingKey(false);
    }
  }

  async function logoutAllSessions() {
    if (!accessToken) {
      return;
    }

    setLogoutAllRunning(true);
    setError(null);

    try {
      await authApi.logoutAll(accessToken);
      await clearSession();
    } catch (logoutAllError) {
      setError(extractApiErrorMessage(logoutAllError));
    } finally {
      setLogoutAllRunning(false);
    }
  }

  async function startTwoFA() {
    if (!accessToken) {
      return;
    }

    try {
      const response = await authApi.startTwoFA(accessToken);
      setSetupSecret(response.secret);
      setSetupProvisioningUri(response.provisioningUri);
    } catch (startError) {
      setError(extractApiErrorMessage(startError));
    }
  }

  async function confirmTwoFA(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    try {
      const response = await authApi.confirmTwoFA(accessToken, setupConfirmCode);
      setRecoveryCodes(response.recoveryCodes);
      await refreshList();
      setSetupConfirmCode("");
    } catch (confirmError) {
      setError(extractApiErrorMessage(confirmError));
    }
  }

  async function disableTwoFA(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!accessToken) {
      return;
    }

    try {
      await authApi.disableTwoFA(accessToken, disableCode);
      await refreshList();
      setDisableCode("");
    } catch (disableError) {
      setError(extractApiErrorMessage(disableError));
    }
  }

  return (
    <section className="page-stack">
      <h1>{t("devices.title")}</h1>
      <p className="text-muted">{t("devices.subtitle")}</p>

      <div className="toolbar">
        <button type="button" onClick={refreshList} disabled={loading}>
          {loading ? t("common.loading") : t("common.refresh")}
        </button>
        <button type="button" onClick={() => void rotateCurrentDeviceKey()} disabled={rotatingKey || !session}>
          {rotatingKey ? t("devices.rotateKeyLoading") : t("devices.rotateKey")}
        </button>
        <button type="button" onClick={() => void logoutAllSessions()} disabled={logoutAllRunning}>
          {logoutAllRunning ? t("devices.logoutEverywhereLoading") : t("devices.logoutEverywhere")}
        </button>
        <label>
          {t("devices.stepUpCode")}
          <input
            value={twoFactorCode}
            onChange={(event) => setTwoFactorCode(event.target.value)}
            placeholder={t("devices.optionalTwoFAPlaceholder")}
          />
        </label>
      </div>

      {session ? (
        <article className="card">
          <h2>{t("devices.accountIdentity")}</h2>
          <p>
            {t("devices.accountIdLabel")}: {session.accountId}
          </p>
          <p>{t("home.email")}: {session.email || "-"}</p>
          <p>
            {t("devices.fingerprint")}: {session.identity.fingerprint.value}
          </p>
          <p>
            {t("devices.safetyNumber")}: {session.identity.fingerprint.safetyNumber}
          </p>
          {session.session.trustWarnings && session.session.trustWarnings.length > 0 ? (
            <div>
              <p className="error-text">{t("home.trustWarnings")}:</p>
              {session.session.trustWarnings.map((warning) => (
                <code key={warning} className="inline-code">
                  {warning}
                </code>
              ))}
            </div>
          ) : null}
        </article>
      ) : null}

      <div className="card-grid">
        <article className="card">
          <h2>{t("devices.trustedPending")}</h2>
          {!data ? <p>{t("common.noData")}</p> : null}
          {data?.devices.map((device) => (
            <div className="list-item" key={device.id}>
              <strong>{device.name}</strong>
              <p>
                {t("common.status")}: {device.status}
              </p>
              <p>
                {t("devices.fingerprint")}: {device.fingerprint.value}
              </p>
              <p>
                {t("devices.safetyNumber")}: {device.fingerprint.safetyNumber}
              </p>
              <p>
                {t("devices.keyVersion")}: {device.keyInfo.version}
              </p>
              <p>
                {t("devices.rotationDue")}: {device.keyInfo.rotationDueAt ?? "-"}
              </p>
              {device.keyInfo.rotationRecommended ? <p className="error-text">{t("devices.keyRotationRecommended")}</p> : null}
              {device.id !== data.currentDeviceId ? (
                <button type="button" onClick={() => revoke(device.id)}>
                  {t("devices.revoke")}
                </button>
              ) : (
                <p className="text-muted">{t("devices.currentDevice")}</p>
              )}
            </div>
          ))}
        </article>

        <article className="card">
          <h2>{t("devices.pendingApprovals")}</h2>
          {data?.approvals.length ? null : <p>{t("common.none")}</p>}
          {data?.approvals.map((approval) => (
            <div className="list-item" key={approval.id}>
              <p>
                {t("devices.requestId")}: {approval.id}
              </p>
              <p>
                {t("devices.deviceLabel")}: {approval.deviceId}
              </p>
              <p>
                {t("common.status")}: {approval.status}
              </p>
              {approval.status === "pending" ? (
                <div className="inline-actions">
                  <button type="button" onClick={() => approve(approval.id)}>
                    {t("devices.approve")}
                  </button>
                  <button type="button" onClick={() => reject(approval.id)}>
                    {t("devices.reject")}
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </article>

        <article className="card">
          <h2>{t("devices.twoFactor")}</h2>
          <p>
            {t("devices.enabledLabel")}: {session?.twoFactorEnabled ? t("common.yes") : t("common.no")}
          </p>
          <button type="button" onClick={startTwoFA}>
            {t("devices.startSetup")}
          </button>
          {setupSecret ? (
            <div>
              <p>
                {t("devices.secret")}: {setupSecret}
              </p>
              <p>
                {t("devices.provisioningUri")}: {setupProvisioningUri}
              </p>
            </div>
          ) : null}

          <form className="form-grid" onSubmit={confirmTwoFA}>
            <label>
              {t("auth.code")}
              <input value={setupConfirmCode} onChange={(event) => setSetupConfirmCode(event.target.value)} />
            </label>
            <button type="submit">{t("devices.enable2FA")}</button>
          </form>

          <form className="form-grid" onSubmit={disableTwoFA}>
            <label>
              {t("auth.code")}
              <input value={disableCode} onChange={(event) => setDisableCode(event.target.value)} />
            </label>
            <button type="submit">{t("devices.disable2FA")}</button>
          </form>
        </article>

        <article className="card">
          <h2>{t("devices.recoveryCodes")}</h2>
          <p className="text-muted">{t("devices.recoveryHint")}</p>
          {recoveryCodes.length === 0 ? <p>{t("devices.noRecoveryCodes")}</p> : null}
          {recoveryCodes.map((code) => (
            <code key={code} className="inline-code">
              {code}
            </code>
          ))}
        </article>
      </div>

      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
