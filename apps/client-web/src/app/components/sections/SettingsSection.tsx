import type {
  AuthSessionResponse,
  DeviceListResponse,
  PrivacyResponse,
  SecurityEventsResponse,
  TwoFactorSetupStartResponse,
} from "@project/protocol";
import { Shield } from "lucide-react";
import * as React from "react";

import { cardStyle, innerCardStyle, outlineButtonStyle, solidButtonStyle } from "../../styles";
import type { SessionMode, SettingsSection as SettingsSectionKey } from "../../types";
import { renderVisibilityScope } from "../../view-utils";
import { InlineInfo } from "../common/StatusInfo";

type SettingsSectionProps = {
  settingsSection: SettingsSectionKey;
  onSettingsSectionChange: (value: SettingsSectionKey) => void;
  settingsMessage: string;
  sessionEmail: string;
  sessionMode: SessionMode;
  onLogout: (all: boolean) => void;
  sessionInfo: AuthSessionResponse | null;
  deviceList: DeviceListResponse | null;
  onRevokeDevice: (deviceId: string) => void;
  twoFASetup: TwoFactorSetupStartResponse | null;
  twoFAEnableCode: string;
  onTwoFAEnableCodeChange: (value: string) => void;
  onStartTwoFactorSetup: () => void;
  onConfirmTwoFactorSetup: () => void;
  twoFADisableCode: string;
  onTwoFADisableCodeChange: (value: string) => void;
  onDisableTwoFactor: () => void;
  securityEvents: SecurityEventsResponse["events"];
  privacy: PrivacyResponse["privacy"] | null;
  onPrivacyPatch: (patch: Partial<PrivacyResponse["privacy"]>) => void;
  onSavePrivacy: () => void;
  serverInput: string;
  onTestConnection: () => void;
  browserNotificationsEnabled: boolean;
  browserNotificationsPermission: NotificationPermission;
  onBrowserNotificationsChange: (enabled: boolean) => void;
  onResetServer: () => void;
};

export function SettingsSection({
  settingsSection,
  onSettingsSectionChange,
  settingsMessage,
  sessionEmail,
  sessionMode,
  onLogout,
  sessionInfo,
  deviceList,
  onRevokeDevice,
  twoFASetup,
  twoFAEnableCode,
  onTwoFAEnableCodeChange,
  onStartTwoFactorSetup,
  onConfirmTwoFactorSetup,
  twoFADisableCode,
  onTwoFADisableCodeChange,
  onDisableTwoFactor,
  securityEvents,
  privacy,
  onPrivacyPatch,
  onSavePrivacy,
  serverInput,
  onTestConnection,
  browserNotificationsEnabled,
  browserNotificationsPermission,
  onBrowserNotificationsChange,
  onResetServer,
}: SettingsSectionProps) {
  return (
    <section className="rounded-2xl border p-4 space-y-4" style={cardStyle}>
      <h3 style={{ color: "var(--text-primary)", fontWeight: 600 }}>Настройки</h3>
      <div className="flex gap-2 flex-wrap">
        {([
          ["account", "Аккаунт"],
          ["sessions", "Сессии"],
          ["devices", "Устройства"],
          ["security", "Безопасность"],
          ["privacy", "Приватность"],
          ["app", "Приложение"],
          ["connection", "Подключение"],
        ] as Array<[SettingsSectionKey, string]>).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="px-3 py-1.5 rounded-lg border text-sm"
            style={settingsSection === value ? solidButtonStyle : outlineButtonStyle}
            onClick={() => onSettingsSectionChange(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {settingsMessage ? <InlineInfo text={settingsMessage} /> : null}

      {settingsSection === "account" ? (
        <div className="rounded-xl border p-3 space-y-3" style={innerCardStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Аккаунт</p>
          <p style={{ color: "var(--base-grey-light)" }}>Email: {sessionEmail}</p>
          <p style={{ color: "var(--base-grey-light)" }}>
            Режим сессии: {sessionMode === "remembered" ? "Запомнить" : "Только вкладка"}
          </p>
          <div className="flex gap-2 flex-wrap">
            <button
              type="button"
              data-testid="settings-logout"
              className="px-4 py-2 rounded-lg border"
              style={outlineButtonStyle}
              onClick={() => onLogout(false)}
            >
              Выйти
            </button>
            <button
              type="button"
              data-testid="settings-logout-all"
              className="px-4 py-2 rounded-lg border"
              style={outlineButtonStyle}
              onClick={() => onLogout(true)}
            >
              Выйти везде
            </button>
          </div>
        </div>
      ) : null}

      {settingsSection === "sessions" ? (
        <div className="rounded-xl border p-3 space-y-2" style={innerCardStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Текущая сессия</p>
          <p style={{ color: "var(--base-grey-light)" }}>Платформа: {sessionInfo?.session.clientPlatform ?? "web-browser"}</p>
          <p style={{ color: "var(--base-grey-light)" }}>Класс: {sessionInfo?.session.sessionClass ?? "browser"}</p>
          <p style={{ color: "var(--base-grey-light)" }}>Постоянная: {sessionInfo?.session.persistent ? "Да" : "Нет"}</p>
          <p style={{ color: "var(--base-grey-light)" }}>
            Создана: {sessionInfo?.session.createdAt ? new Date(sessionInfo.session.createdAt as string).toLocaleString("ru-RU") : "-"}
          </p>
        </div>
      ) : null}

      {settingsSection === "devices" ? (
        <div className="rounded-xl border p-3 space-y-2" style={innerCardStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Устройства</p>
          {(deviceList?.devices ?? []).map((device) => {
            const id = device.id as string;
            const isCurrent = deviceList?.currentDeviceId === device.id;
            return (
              <div key={id} className="rounded-lg border px-3 py-2 flex items-center justify-between" style={innerCardStyle}>
                <div>
                  <p style={{ color: "var(--text-primary)" }}>{device.name}</p>
                  <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                    {device.platform} · {device.status}
                  </p>
                </div>
                {!isCurrent ? (
                  <button type="button" className="px-3 py-1.5 rounded-lg border text-sm" style={outlineButtonStyle} onClick={() => onRevokeDevice(id)}>
                    Отозвать
                  </button>
                ) : (
                  <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: "var(--accent-brown)", color: "var(--core-background)" }}>
                    Текущее
                  </span>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {settingsSection === "security" ? (
        <div className="rounded-xl border p-3 space-y-3" style={innerCardStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>2FA и события безопасности</p>
          <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={onStartTwoFactorSetup}>
            <Shield className="w-4 h-4 inline mr-2" />
            Начать настройку 2FA
          </button>
          {twoFASetup ? (
            <div className="space-y-2 rounded-lg border p-3" style={innerCardStyle}>
              <p style={{ color: "var(--base-grey-light)", fontSize: 12, wordBreak: "break-all" }}>Секрет: {twoFASetup.secret}</p>
              <p style={{ color: "var(--base-grey-light)", fontSize: 12, wordBreak: "break-all" }}>
                URI: {twoFASetup.provisioningUri}
              </p>
              <input
                value={twoFAEnableCode}
                onChange={(event) => onTwoFAEnableCodeChange(event.target.value)}
                placeholder="Код из приложения"
                className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
                style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
              />
              <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={onConfirmTwoFactorSetup}>
                Подтвердить 2FA
              </button>
            </div>
          ) : null}
          <div className="space-y-2">
            <input
              value={twoFADisableCode}
              onChange={(event) => onTwoFADisableCodeChange(event.target.value)}
              placeholder="Код для отключения 2FA"
              className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
              style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
            />
            <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={onDisableTwoFactor}>
              Отключить 2FA
            </button>
          </div>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>События</p>
          {securityEvents.slice(0, 10).map((event) => (
            <div key={event.id as string} className="rounded-lg border px-3 py-2" style={innerCardStyle}>
              <p style={{ color: "var(--text-primary)" }}>{event.eventType}</p>
              <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                {new Date(event.createdAt as string).toLocaleString("ru-RU")}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {settingsSection === "privacy" ? (
        <div className="rounded-xl border p-3 space-y-3" style={innerCardStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Приватность профиля</p>
          {!privacy ? (
            <InlineInfo text="Настройки приватности загружаются..." />
          ) : (
            <>
              <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                Профиль: {renderVisibilityScope(privacy.profileVisibility)} · Публикации: {renderVisibilityScope(privacy.postsVisibility)} · Фото: {renderVisibilityScope(privacy.photosVisibility)}
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                <select
                  value={privacy.postsVisibility}
                  onChange={(event) => onPrivacyPatch({ postsVisibility: event.target.value as never })}
                  className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
                  style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
                >
                  <option value="public">Публикации: всем</option>
                  <option value="friends">Публикации: друзьям</option>
                  <option value="only_me">Публикации: только мне</option>
                </select>
                <select
                  value={privacy.dmPolicy}
                  onChange={(event) => onPrivacyPatch({ dmPolicy: event.target.value as never })}
                  className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
                  style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
                >
                  <option value="friends">ЛС: только друзья</option>
                  <option value="everyone">ЛС: все</option>
                  <option value="nobody">ЛС: никто</option>
                </select>
                <select
                  value={privacy.friendRequestsPolicy}
                  onChange={(event) => onPrivacyPatch({ friendRequestsPolicy: event.target.value as never })}
                  className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
                  style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
                >
                  <option value="anyone">Заявки: от всех</option>
                  <option value="friends_of_friends">Заявки: друзья друзей</option>
                  <option value="nobody">Заявки: никто</option>
                </select>
              </div>
              <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={onSavePrivacy}>
                Сохранить приватность
              </button>
            </>
          )}
        </div>
      ) : null}

      {settingsSection === "app" ? (
        <div className="rounded-xl border p-3 space-y-2" style={innerCardStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Приложение</p>
          <p style={{ color: "var(--base-grey-light)" }}>Тема: Темная</p>
          <p style={{ color: "var(--base-grey-light)" }}>Язык: Русский</p>
          <p style={{ color: "var(--base-grey-light)" }}>In-app уведомления: включены</p>
          <p style={{ color: "var(--base-grey-light)" }}>
            Browser notifications: {browserNotificationsEnabled ? "включены" : "выключены"} ({browserNotificationsPermission})
          </p>
          <button
            type="button"
            data-testid="settings-browser-notifications-toggle"
            className="px-3 py-2 rounded-lg border"
            style={outlineButtonStyle}
            onClick={() => onBrowserNotificationsChange(!browserNotificationsEnabled)}
          >
            {browserNotificationsEnabled ? "Отключить browser notifications" : "Включить browser notifications"}
          </button>
        </div>
      ) : null}

      {settingsSection === "connection" ? (
        <div className="rounded-xl border p-3 space-y-3" style={innerCardStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Сервер и подключение</p>
          <p style={{ color: "var(--base-grey-light)" }}>Текущий сервер: {serverInput}</p>
          <div className="flex gap-2 flex-wrap">
            <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={onTestConnection}>
              Проверить соединение
            </button>
            <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={onResetServer}>
              Сменить сервер
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
