import React, { FormEvent, useMemo, useState } from "react";

import type { MessageDTO } from "@project/protocol";

import { useAuth } from "./auth-context";
import { useBootstrap } from "./bootstrap-context";
import { useMessaging } from "./messaging-context";
import { useTransport } from "./transport-context";

type ProductSection = "overview" | "messaging" | "contacts" | "groups" | "security" | "settings";

interface SectionItem {
  id: ProductSection;
  title: string;
  subtitle: string;
}

const sectionItems: SectionItem[] = [
  { id: "overview", title: "Обзор", subtitle: "Краткая сводка аккаунта" },
  { id: "messaging", title: "Сообщения", subtitle: "Диалоги и история" },
  { id: "contacts", title: "Контакты", subtitle: "Люди и быстрые действия" },
  { id: "groups", title: "Группы", subtitle: "Чаты и участники" },
  { id: "security", title: "Безопасность", subtitle: "Сессии и устройства" },
  { id: "settings", title: "Настройки", subtitle: "Сервер и параметры" },
];

export function AppShell() {
  const bootstrap = useBootstrap();
  const auth = useAuth();
  const transport = useTransport();
  const messaging = useMessaging();

  const [serverInput, setServerInput] = useState(bootstrap.serverConfig?.inputHost ?? "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [activeSection, setActiveSection] = useState<ProductSection>("messaging");

  if (bootstrap.status === "booting") {
    return <StatusPanel title="Запуск приложения" message="Проверяем конфигурацию сервера..." />;
  }

  if (bootstrap.status === "needs_server" || bootstrap.status === "error") {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Подключение к серверу</h1>
          <p className="muted">Введите домен или IP-адрес вашего сервера. Приложение само получит конфигурацию.</p>
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              await bootstrap.connectToServer(serverInput);
            }}
          >
            <label>
              Адрес сервера
              <input
                value={serverInput}
                onChange={(event) => setServerInput(event.target.value)}
                placeholder="chat.example.com или 203.0.113.10:8080"
                autoFocus
              />
            </label>
            <button type="submit">Подключиться</button>
          </form>
          {bootstrap.errorMessage ? <div className="error-box">{bootstrap.errorMessage}</div> : null}
          <p className="muted">Поддерживаются: домен, IP, адрес с портом, URL с http/https.</p>
        </section>
      </main>
    );
  }

  if (auth.phase === "restoring") {
    return <StatusPanel title="Восстанавливаем сессию" message="Пожалуйста, подождите..." />;
  }

  if (auth.phase === "two_fa_required") {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Подтверждение 2FA</h1>
          <p className="muted">Введите код из приложения-аутентификатора.</p>
          <form
            className="form-grid"
            onSubmit={async (event: FormEvent) => {
              event.preventDefault();
              await auth.verifyTwoFactor(twoFactorCode);
            }}
          >
            <label>
              Код подтверждения
              <input
                value={twoFactorCode}
                onChange={(event) => setTwoFactorCode(event.target.value)}
                placeholder="123456"
                autoFocus
              />
            </label>
            <button type="submit">Подтвердить и войти</button>
          </form>
          {auth.errorMessage ? <div className="error-box">{auth.errorMessage}</div> : null}
        </section>
      </main>
    );
  }

  if (auth.phase !== "authenticated" || !auth.session) {
    return (
      <main className="auth-shell">
        <section className="auth-card">
          <h1>Вход в веб-версию</h1>
          <p className="muted">Веб-сессии изолированы от доверенных настольных устройств.</p>
          <form
            className="form-grid"
            onSubmit={async (event: FormEvent) => {
              event.preventDefault();
              await auth.login(email, password);
            }}
          >
            <label>
              Электронная почта
              <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" />
            </label>
            <label>
              Пароль
              <input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete="current-password"
              />
            </label>
            <label>
              Режим сессии
              <select
                value={auth.persistenceMode}
                onChange={(event) => auth.setPersistenceMode(event.target.value === "remembered" ? "remembered" : "ephemeral")}
              >
                <option value="ephemeral">Только текущая вкладка</option>
                <option value="remembered">Запомнить на этом браузере</option>
              </select>
            </label>
            <button type="submit">Войти</button>
          </form>
          {auth.errorMessage ? <div className="error-box">{auth.errorMessage}</div> : null}
        </section>
      </main>
    );
  }

  const selectedSectionMeta = sectionItems.find((item) => item.id === activeSection) ?? sectionItems[0];
  const transportHint = resolveTransportHint(transport.runtime.status, transport.lastError);

  return (
    <main className="web-product-shell">
      <aside className="web-sidebar">
        <div className="brand-title">Защищённый мессенджер</div>

        <section className="user-card">
          <strong>{auth.session.email || "Аккаунт без почты"}</strong>
          <span className="muted">Платформа: {platformLabel(auth.session.session.clientPlatform)}</span>
          <span className="muted">Сессия: {auth.session.session.persistent ? "запомнена" : "временная"}</span>
        </section>

        <nav className="nav-stack">
          {sectionItems.map((item) => (
            <button
              type="button"
              key={item.id}
              className={`nav-button ${item.id === activeSection ? "active" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              <strong>{item.title}</strong>
              <span className="muted">{item.subtitle}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <button type="button" className="button-secondary" onClick={() => transport.reconnect()}>
            Переподключить транспорт
          </button>
          <button type="button" className="button-secondary" onClick={() => void auth.logoutAll()}>
            Выйти на всех устройствах
          </button>
          <button type="button" className="button-secondary" onClick={() => void auth.logout()}>
            Выйти
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={async () => {
              await auth.logout();
              bootstrap.resetServerConfig();
            }}
          >
            Сменить сервер
          </button>
        </div>
      </aside>

      <section className="web-workspace">
        <header className="web-topbar">
          <div>
            <h1>{selectedSectionMeta.title}</h1>
            <p className="muted">{selectedSectionMeta.subtitle}</p>
          </div>
          <div className="topbar-actions">
            <span className={`badge ${transportBadgeClass(transport.runtime.status)}`}>{transportBadgeLabel(transport.runtime.status)}</span>
            <span className="badge badge-neutral">Режим: {runtimeModeLabel(transport.runtime.mode)}</span>
          </div>
        </header>

        {transportHint ? (
          <section className={`banner ${transportHint.tone === "warning" ? "warning" : ""}`}>
            <strong>{transportHint.title}</strong>
            <p className="muted">{transportHint.message}</p>
          </section>
        ) : null}

        <section className="content-area">
          {activeSection === "messaging" ? (
            <MessagingWorkspace />
          ) : (
            <ProductSectionStub
              section={activeSection}
              onOpenMessaging={() => setActiveSection("messaging")}
              onOpenSecurity={() => setActiveSection("security")}
            />
          )}
        </section>
      </section>
    </main>
  );
}

function MessagingWorkspace() {
  const messaging = useMessaging();
  const auth = useAuth();
  const [directAccountInput, setDirectAccountInput] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembersInput, setGroupMembersInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [createStatus, setCreateStatus] = useState<"idle" | "creating">("idle");

  const activeHeader = useMemo(() => {
    const conversation = messaging.selectedConversation;
    if (!conversation) {
      return { title: "Диалог не выбран", subtitle: "Выберите диалог слева или создайте новый." };
    }
    const title = conversation.title || (conversation.type === "group" ? "Групповой чат" : "Личный чат");
    const membersText = conversation.type === "group" ? `${conversation.members.length} участников` : "Личный диалог";
    return { title, subtitle: `${membersText} · обновлён ${formatDateTime(conversation.updatedAt)}` };
  }, [messaging.selectedConversation]);

  const handleCreateDirect = async (event: FormEvent) => {
    event.preventDefault();
    if (!directAccountInput.trim()) {
      setCreateError("Введите идентификатор пользователя.");
      return;
    }
    setCreateStatus("creating");
    setCreateError(null);
    const created = await messaging.createDirectConversation(directAccountInput.trim());
    if (!created) {
      setCreateError(messaging.conversationsError ?? "Не удалось создать личный чат.");
    } else {
      setDirectAccountInput("");
    }
    setCreateStatus("idle");
  };

  const handleCreateGroup = async (event: FormEvent) => {
    event.preventDefault();
    if (!groupTitle.trim()) {
      setCreateError("Введите название группы.");
      return;
    }
    const members = groupMembersInput
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);
    setCreateStatus("creating");
    setCreateError(null);
    const created = await messaging.createGroupConversation(groupTitle.trim(), members);
    if (!created) {
      setCreateError(messaging.conversationsError ?? "Не удалось создать группу.");
    } else {
      setGroupTitle("");
      setGroupMembersInput("");
    }
    setCreateStatus("idle");
  };

  return (
    <div className="messaging-layout">
      <section className="panel-card conversation-pane">
        <div className="row-space">
          <h2>Диалоги</h2>
          <button type="button" className="button-secondary" onClick={() => void messaging.refreshConversations()}>
            Обновить
          </button>
        </div>

        <div className="conversation-create-stack">
          <form className="form-grid conversation-create-card" onSubmit={handleCreateDirect}>
            <strong>Новый личный чат</strong>
            <input
              value={directAccountInput}
              onChange={(event) => setDirectAccountInput(event.target.value)}
              placeholder="ID пользователя (UUID)"
            />
            <button type="submit" disabled={createStatus === "creating"}>
              Создать личный чат
            </button>
          </form>

          <form className="form-grid conversation-create-card" onSubmit={handleCreateGroup}>
            <strong>Новая группа</strong>
            <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Название группы" />
            <input
              value={groupMembersInput}
              onChange={(event) => setGroupMembersInput(event.target.value)}
              placeholder="ID участников (UUID через запятую)"
            />
            <button type="submit" disabled={createStatus === "creating"}>
              Создать группу
            </button>
          </form>
        </div>

        {createError ? <div className="error-box">{createError}</div> : null}

        <ConversationList />
      </section>

      <section className="panel-card message-pane">
        <header className="conversation-header">
          <h2>{activeHeader.title}</h2>
          <p className="muted">{activeHeader.subtitle}</p>
        </header>

        <MessageHistory currentAccountId={auth.session?.accountId ?? ""} />

        <ComposerScaffold />
      </section>
    </div>
  );
}

function ConversationList() {
  const messaging = useMessaging();

  if (messaging.conversationsStatus === "loading") {
    return (
      <div className="conversation-list">
        {Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="conversation-skeleton" />
        ))}
      </div>
    );
  }

  if (messaging.conversationsStatus === "error") {
    return (
      <div className="empty-state-card">
        <strong>Не удалось загрузить диалоги</strong>
        <p className="muted">{messaging.conversationsError ?? "Проверьте соединение и повторите попытку."}</p>
        <button type="button" onClick={() => void messaging.refreshConversations()}>
          Повторить
        </button>
      </div>
    );
  }

  if (messaging.conversations.length === 0) {
    return (
      <div className="empty-state-card">
        <strong>Пока нет диалогов</strong>
        <p className="muted">Создайте личный чат или группу, чтобы начать общение.</p>
      </div>
    );
  }

  return (
    <div className="conversation-list">
      {messaging.conversations.map((conversation) => {
        const active = conversation.id === messaging.selectedConversationId;
        const title = conversation.title || (conversation.type === "group" ? "Групповой чат" : "Личный чат");
        const subtitle = conversation.type === "group" ? `${conversation.members.length} участников` : "Личный диалог";
        return (
          <button
            type="button"
            key={conversation.id}
            className={`conversation-item ${active ? "active" : ""}`}
            onClick={() => void messaging.selectConversation(conversation.id)}
          >
            <div className="conversation-item-top">
              <strong>{title}</strong>
              <span className="muted">{formatTimeOnly(conversation.updatedAt)}</span>
            </div>
            <p className="muted conversation-subline">{subtitle}</p>
          </button>
        );
      })}
    </div>
  );
}

function MessageHistory({ currentAccountId }: { currentAccountId: string }) {
  const messaging = useMessaging();

  if (!messaging.selectedConversation) {
    return (
      <div className="history-empty">
        <strong>Выберите диалог</strong>
        <p className="muted">Список диалогов находится слева. После выбора здесь появится история сообщений.</p>
      </div>
    );
  }

  if (messaging.activeMessagesStatus === "loading") {
    return (
      <div className="messages-scroll">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className={`message-skeleton ${index % 2 === 0 ? "self" : ""}`} />
        ))}
      </div>
    );
  }

  if (messaging.activeMessagesStatus === "error") {
    return (
      <div className="history-empty">
        <strong>Не удалось загрузить историю</strong>
        <p className="muted">{messaging.activeMessagesError ?? "Попробуйте обновить диалог."}</p>
        <button type="button" onClick={() => void messaging.reloadActiveMessages()}>
          Обновить историю
        </button>
      </div>
    );
  }

  if (messaging.activeMessages.length === 0) {
    return (
      <div className="history-empty">
        <strong>История пока пустая</strong>
        <p className="muted">Сообщения появятся здесь, как только они будут доставлены в диалог.</p>
      </div>
    );
  }

  return (
    <div className="messages-scroll">
      {messaging.activeMessages.map((message) => (
        <MessageBubble key={message.envelope.id} message={message} isOwn={message.envelope.senderAccountId === currentAccountId} />
      ))}
    </div>
  );
}

function MessageBubble({ message, isOwn }: { message: MessageDTO; isOwn: boolean }) {
  return (
    <article className={`message-item ${isOwn ? "self" : ""}`}>
      <header className="message-item-top">
        <strong>{isOwn ? "Вы" : shortId(message.envelope.senderAccountId)}</strong>
        <div className="message-item-meta">
          <span className={`badge ${deliveryBadgeClass(message.deliveryState)}`}>{deliveryStateLabel(message.deliveryState)}</span>
          <span className="muted">{formatDateTime(message.envelope.createdAt)}</span>
        </div>
      </header>
      <p className="message-preview">Содержимое защищено сквозным шифрованием и будет доступно после полной браузерной криптоподдержки.</p>
      {message.envelope.attachments.length > 0 ? (
        <p className="muted message-attachments">Вложений: {message.envelope.attachments.length}</p>
      ) : null}
      {message.failedReason ? <p className="message-failed">{message.failedReason}</p> : null}
    </article>
  );
}

function ComposerScaffold() {
  const messaging = useMessaging();
  return (
    <section className="composer-shell">
      <label>
        Сообщение
        <textarea rows={3} placeholder="Поле отправки появится здесь после включения браузерной криптографии." disabled />
      </label>
      {messaging.composerDisabledReason ? <p className="muted composer-note">{messaging.composerDisabledReason}</p> : null}
      <div className="button-row">
        <button type="button" disabled>
          Отправить
        </button>
        <button type="button" className="button-secondary" onClick={() => void messaging.reloadActiveMessages()}>
          Обновить историю
        </button>
      </div>
    </section>
  );
}

function ProductSectionStub({
  section,
  onOpenMessaging,
  onOpenSecurity,
}: {
  section: Exclude<ProductSection, "messaging">;
  onOpenMessaging: () => void;
  onOpenSecurity: () => void;
}) {
  if (section === "overview") {
    return (
      <div className="page-grid two">
        <article className="panel-card">
          <h2>Главное</h2>
          <p className="muted">Это веб-основа продукта. Для продолжения работы откройте раздел сообщений.</p>
          <button type="button" onClick={onOpenMessaging}>
            Перейти к диалогам
          </button>
        </article>
        <article className="panel-card">
          <h2>Статус защиты</h2>
          <p className="muted">Управление устройствами и сессиями находится в разделе безопасности.</p>
          <button type="button" className="button-secondary" onClick={onOpenSecurity}>
            Открыть безопасность
          </button>
        </article>
      </div>
    );
  }

  const sectionLabels: Record<Exclude<ProductSection, "overview" | "messaging">, string> = {
    contacts: "Контакты",
    groups: "Группы",
    security: "Безопасность",
    settings: "Настройки",
  };

  return (
    <article className="panel-card">
      <h2>{sectionLabels[section]}</h2>
      <p className="muted">
        Этот раздел подготовлен как часть веб-ориентированного каркаса. Сейчас основной рабочий поток находится в сообщениях.
      </p>
      <button type="button" onClick={onOpenMessaging}>
        Вернуться к диалогам
      </button>
    </article>
  );
}

function StatusPanel({ title, message }: { title: string; message: string }) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{title}</h1>
        <p className="muted">{message}</p>
      </section>
    </main>
  );
}

function shortId(value: string | null | undefined): string {
  if (!value) {
    return "Пользователь";
  }
  return value.length > 10 ? `${value.slice(0, 8)}…` : value;
}

function formatDateTime(value: string): string {
  try {
    return new Date(value).toLocaleString("ru-RU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return value;
  }
}

function formatTimeOnly(value: string): string {
  try {
    return new Date(value).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "--:--";
  }
}

function deliveryStateLabel(state: MessageDTO["deliveryState"]): string {
  const labels: Record<MessageDTO["deliveryState"], string> = {
    pending: "Ожидание",
    queued: "В очереди",
    sent: "Отправлено",
    delivered: "Доставлено",
    failed: "Ошибка",
    expired: "Истекло",
  };
  return labels[state];
}

function deliveryBadgeClass(state: MessageDTO["deliveryState"]): string {
  if (state === "delivered" || state === "sent") {
    return "badge-good";
  }
  if (state === "failed" || state === "expired") {
    return "badge-error";
  }
  if (state === "pending" || state === "queued") {
    return "badge-warn";
  }
  return "badge-neutral";
}

function transportBadgeClass(status: string): string {
  if (status === "online") {
    return "badge-good";
  }
  if (status === "degraded" || status === "connecting") {
    return "badge-warn";
  }
  if (status === "forbidden") {
    return "badge-error";
  }
  return "badge-neutral";
}

function runtimeModeLabel(mode: string): string {
  if (mode === "websocket") {
    return "WebSocket";
  }
  if (mode === "long-poll") {
    return "Long-poll (резервный режим)";
  }
  return "Нет активного канала";
}

function platformLabel(platform: string | undefined): string {
  if (!platform || platform === "web-browser") {
    return "Веб-браузер";
  }
  if (platform === "desktop-tauri") {
    return "Настольный клиент";
  }
  return platform;
}

function transportBadgeLabel(status: string): string {
  if (status === "online") {
    return "Соединение активно";
  }
  if (status === "connecting") {
    return "Подключаемся";
  }
  if (status === "degraded") {
    return "Нестабильное соединение";
  }
  if (status === "forbidden") {
    return "Сессия недействительна";
  }
  return "Оффлайн";
}

function resolveTransportHint(status: string, rawError: string | null): { title: string; message: string; tone: "info" | "warning" } | null {
  if (status === "degraded") {
    return {
      title: "Соединение нестабильно",
      message: "Мы автоматически перешли в резервный режим. История продолжит обновляться, но возможны задержки.",
      tone: "warning",
    };
  }
  if (status === "offline") {
    return {
      title: "Нет подключения к сети",
      message: "Проверьте интернет. После восстановления сети приложение переподключится автоматически.",
      tone: "warning",
    };
  }
  if (status === "forbidden") {
    return {
      title: "Сессия устарела",
      message: "Для продолжения работы войдите в аккаунт снова.",
      tone: "warning",
    };
  }
  if (rawError) {
    return {
      title: "Есть проблемы с транспортом",
      message: humanizeTransportError(rawError),
      tone: "info",
    };
  }
  return null;
}

function humanizeTransportError(message: string): string {
  if (message.includes("websocket")) {
    return "Не удалось удержать WebSocket-соединение. Используем fallback и повторяем попытки.";
  }
  if (message.includes("endpoint") || message.includes("network")) {
    return "Сервер временно недоступен. Проверьте сеть и попробуйте снова.";
  }
  return "Соединение временно нестабильно. Приложение пытается восстановиться автоматически.";
}
