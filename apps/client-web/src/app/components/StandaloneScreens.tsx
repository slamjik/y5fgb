import type { LoginTwoFactorRequiredResponse } from "@project/protocol";
import React from "react";

import { cardStyle, outlineButtonStyle, solidButtonStyle } from "../styles";
import type { AuthMode, SessionMode } from "../types";
import { InlineInfo } from "./common/StatusInfo";

export function AutoConnectScreen({ onRetry, error }: { onRetry: () => Promise<void>; error: string }) {
  return (
    <StandaloneCard title="Подключение к серверу" subtitle="Пытаемся подключиться автоматически к текущему домену сайта.">
      {error ? <InlineInfo tone="error" text={error} /> : null}
      <button
        type="button"
        className="w-full rounded-lg border px-4 py-2"
        style={outlineButtonStyle}
        onClick={() => void onRetry()}
      >
        Повторить подключение
      </button>
    </StandaloneCard>
  );
}

export function AuthScreen(props: {
  server: string;
  mode: SessionMode;
  pending2fa: LoginTwoFactorRequiredResponse | null;
  error: string;
  onModeChange: (mode: SessionMode) => Promise<void>;
  onSubmit: (mode: AuthMode, email: string, password: string) => Promise<void>;
  onVerify: (code: string) => Promise<void>;
  onChangeServer: () => Promise<void> | void;
}) {
  const [authMode, setAuthMode] = React.useState<AuthMode>("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");

  return (
    <StandaloneCard title="Вход в веб-версию" subtitle={`Сервер: ${props.server}`}>
      {props.pending2fa ? (
        <>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="Код 2FA"
            className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
            style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
          />
          <button
            type="button"
            className="w-full rounded-lg border px-4 py-2"
            style={outlineButtonStyle}
            onClick={() => void props.onVerify(code)}
          >
            Подтвердить
          </button>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border"
              style={authMode === "login" ? solidButtonStyle : outlineButtonStyle}
              onClick={() => setAuthMode("login")}
            >
              Вход
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border"
              style={authMode === "register" ? solidButtonStyle : outlineButtonStyle}
              onClick={() => setAuthMode("register")}
            >
              Регистрация
            </button>
          </div>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="Email"
            className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
            style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Пароль"
            className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
            style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
          />
          <select
            value={props.mode}
            onChange={(e) => void props.onModeChange(e.target.value as SessionMode)}
            className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
            style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
          >
            <option value="ephemeral">Только текущая вкладка</option>
            <option value="remembered">Запомнить на устройстве</option>
          </select>
          <button
            type="button"
            className="w-full rounded-lg border px-4 py-2"
            style={outlineButtonStyle}
            onClick={() => void props.onSubmit(authMode, email, password)}
          >
            {authMode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
        </>
      )}
      <button
        type="button"
        className="text-sm underline"
        style={{ color: "var(--base-grey-light)" }}
        onClick={() => void props.onChangeServer()}
      >
        Сменить сервер
      </button>
      {props.error ? <InlineInfo tone="error" text={props.error} /> : null}
    </StandaloneCard>
  );
}

export function StandaloneCard({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "var(--core-background)" }}>
      <div className="w-full max-w-[480px] rounded-2xl border p-6 space-y-3" style={cardStyle}>
        <h1 style={{ color: "var(--text-primary)", fontSize: 28, fontWeight: 600 }}>{title}</h1>
        <p style={{ color: "var(--base-grey-light)" }}>{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

