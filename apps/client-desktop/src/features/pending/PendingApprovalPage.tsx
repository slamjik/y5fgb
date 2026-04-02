import { FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate, useNavigate } from "react-router-dom";

import type { RecoveryFlowID } from "@project/shared-types";

import { extractApiErrorMessage } from "@/services/apiClient";
import { devicesApi } from "@/services/devicesApi";
import { recoveryApi } from "@/services/recoveryApi";
import { useAuthStore } from "@/state/authStore";

export function PendingApprovalPage() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const pending = useAuthStore((state) => state.pendingApproval);
  const setPendingApproval = useAuthStore((state) => state.setPendingApproval);

  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [recoveryFlowId, setRecoveryFlowID] = useState<RecoveryFlowID | null>(null);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);

  if (!pending) {
    return <Navigate to="/auth/login" replace />;
  }

  const currentPending = pending;

  async function checkStatus() {
    setError(null);
    try {
      const status = await devicesApi.approvalStatus(currentPending.approvalRequestId, currentPending.approvalPollToken);
      if (status.status === "approved") {
        setStatusMessage(t("auth.pendingStatusApproved"));
        setPendingApproval(null);
      } else if (status.status === "rejected") {
        setStatusMessage(t("auth.pendingStatusRejected"));
      } else if (status.status === "expired") {
        setStatusMessage(t("auth.pendingStatusExpired"));
      } else {
        setStatusMessage(t("auth.pendingStatusWaiting"));
      }
    } catch (statusError) {
      setError(extractApiErrorMessage(statusError));
    }
  }

  async function startRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    try {
      const response = await recoveryApi.start({
        email: recoveryEmail,
        approvalRequestId: currentPending.approvalRequestId,
      });
      setRecoveryFlowID(response.recoveryFlowId);
      setRecoveryToken(response.recoveryToken);
      setStatusMessage(t("auth.recoveryStarted"));
    } catch (recoveryError) {
      setError(extractApiErrorMessage(recoveryError));
    }
  }

  async function completeRecovery() {
    if (!recoveryFlowId || !recoveryToken) {
      setError(t("auth.recoveryNeedsStart"));
      return;
    }

    setError(null);

    try {
      await recoveryApi.complete({
        recoveryFlowId,
        recoveryToken,
        recoveryCode,
        twoFactorCode: twoFactorCode || undefined,
      });
      setStatusMessage(t("auth.recoveryCompleted"));
      setPendingApproval(null);
      navigate("/auth/login", { replace: true });
    } catch (recoveryError) {
      setError(extractApiErrorMessage(recoveryError));
    }
  }

  return (
    <section className="form-shell page-stack">
      <h1>{t("auth.pendingTitle")}</h1>
      <p className="text-muted">{t("auth.pendingSubtitle")}</p>

      <div className="card-grid">
        <article className="card">
          <h2>{t("auth.approval")}</h2>
          <p>ID: {currentPending.approvalRequestId}</p>
          <p>
            {t("common.status")}: {currentPending.status}
          </p>
          <button type="button" onClick={checkStatus}>
            {t("auth.approvalCheck")}
          </button>
        </article>

        <article className="card">
          <h2>{t("auth.recovery")}</h2>
          <form className="form-grid" onSubmit={startRecovery}>
            <label>
              {t("auth.email")}
              <input value={recoveryEmail} onChange={(event) => setRecoveryEmail(event.target.value)} required />
            </label>
            <button type="submit">{t("auth.startRecovery")}</button>
          </form>

          <label>
            {t("auth.recoveryCode")}
            <input value={recoveryCode} onChange={(event) => setRecoveryCode(event.target.value)} />
          </label>

          <label>
            {t("auth.twoFactorCode")}
            <input value={twoFactorCode} onChange={(event) => setTwoFactorCode(event.target.value)} />
          </label>

          <button type="button" onClick={completeRecovery}>
            {t("auth.completeRecovery")}
          </button>
        </article>
      </div>

      {statusMessage ? <p className="state-message">{statusMessage}</p> : null}
      {error ? <p className="error-text">{error}</p> : null}

      <p>
        <Link to="/auth/login">{t("auth.backToLogin")}</Link>
      </p>
    </section>
  );
}
