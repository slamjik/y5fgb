import React, { FormEvent, useMemo, useState } from "react";

import type { ConversationDTO, MessageDTO } from "@project/protocol";

import { useAuth } from "./auth-context";
import { useBootstrap } from "./bootstrap-context";
import { useMessaging } from "./messaging-context";
import { useTransport } from "./transport-context";

type AuthState = ReturnType<typeof useAuth>;
type BootstrapState = ReturnType<typeof useBootstrap>;
type MessagingState = ReturnType<typeof useMessaging>;
type TransportState = ReturnType<typeof useTransport>;

type MainSection = "home" | "messages" | "contacts" | "groups" | "profile" | "settings";
type SettingsSection =
  | "general"
  | "account"
  | "appearance"
  | "notifications"
  | "privacy"
  | "security"
  | "devices"
  | "server"
  | "data"
  | "about";

const MAIN_NAV: Array<{ id: MainSection; title: string; subtitle: string }> = [
  { id: "home", title: "Главная", subtitle: "Обзор и активность" },
  { id: "messages", title: "Сообщения", subtitle: "Чаты и переписка" },
  { id: "contacts", title: "Контакты", subtitle: "Люди и заявки" },
  { id: "groups", title: "Группы", subtitle: "Сообщества" },
  { id: "profile", title: "Профиль", subtitle: "Ваш аккаунт" },
  { id: "settings", title: "Настройки", subtitle: "Параметры приложения" },
];

const SETTINGS_NAV: Array<{ id: SettingsSection; title: string; description: string }> = [
  { id: "general", title: "Общие", description: "Базовые параметры приложения" },
  { id: "account", title: "Аккаунт", description: "Почта, вход и выход" },
  { id: "appearance", title: "Внешний вид", description: "Тема и плотность интерфейса" },
  { id: "notifications", title: "Уведомления", description: "Как вы получаете уведомления" },
  { id: "privacy", title: "Конфиденциальность", description: "Видимость и приватность" },
  { id: "security", title: "Безопасность", description: "2FA и защита входа" },
  { id: "devices", title: "Устройства и сессии", description: "Текущая сессия и активные входы" },
  { id: "server", title: "Сервер и подключение", description: "Адрес сервера и качество связи" },
  { id: "data", title: "Данные и хранилище", description: "Локальные данные в браузере" },
  { id: "about", title: "О приложении", description: "Версия и справка" },
];

export function AppShell() {
  const bootstrap = useBootstrap();
  const auth = useAuth();
  const messaging = useMessaging();
  const transport = useTransport();

  const [serverInput, setServerInput] = useState(bootstrap.serverConfig?.inputHost ?? "");
  const [authMode, setAuthMode] = useState<"register" | "login">("register");
  const [authErrorLocal, setAuthErrorLocal] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordRepeat, setRegisterPasswordRepeat] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");

  const [activeSection, setActiveSection] = useState<MainSection>("home");
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [chatSearch, setChatSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [directAccountInput, setDirectAccountInput] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembersInput, setGroupMembersInput] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);

  const sortedConversations = useMemo(
    () => [...messaging.conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [messaging.conversations],
  );

  const recentConversations = useMemo(() => sortedConversations.slice(0, 6), [sortedConversations]);

  const filteredConversations = useMemo(() => {
    const normalized = chatSearch.trim().toLowerCase();
    if (!normalized) {
      return sortedConversations;
    }
    return sortedConversations.filter((conversation) => {
      const title = buildConversationTitle(conversation, auth.session?.accountId).toLowerCase();
      const members = conversation.members.map((member) => member.accountId.toLowerCase()).join(" ");
      return title.includes(normalized) || members.includes(normalized);
    });
  }, [auth.session?.accountId, chatSearch, sortedConversations]);

  const groups = useMemo(
    () => sortedConversations.filter((conversation) => conversation.type === "group"),
    [sortedConversations],
  );

  const contacts = useMemo(() => {
    const currentAccountId = auth.session?.accountId ?? "";
    const byId = new Map<string, { accountId: string; conversationsCount: number; updatedAt: string }>();

    for (const conversation of sortedConversations) {
      for (const member of conversation.members) {
        if (!member.accountId || member.accountId === currentAccountId) {
          continue;
        }
        const existing = byId.get(member.accountId);
        if (existing) {
          existing.conversationsCount += 1;
          if (new Date(conversation.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
            existing.updatedAt = conversation.updatedAt;
          }
          continue;
        }
        byId.set(member.accountId, {
          accountId: member.accountId,
          conversationsCount: 1,
          updatedAt: conversation.updatedAt,
        });
      }
    }

    return [...byId.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [auth.session?.accountId, sortedConversations]);

  const filteredContacts = useMemo(() => {
    const normalized = contactSearch.trim().toLowerCase();
    if (!normalized) {
      return contacts;
    }
    return contacts.filter((contact) => contact.accountId.toLowerCase().includes(normalized));
  }, [contactSearch, contacts]);

  const pageMeta = useMemo(() => MAIN_NAV.find((item) => item.id === activeSection) ?? MAIN_NAV[0], [activeSection]);
  const transportNotice = resolveTransportNotice(transport.runtime.status);

  if (bootstrap.status === "booting") {
    return <StatusScreen title="Запуск приложения" message="Проверяем подключение к серверу..." />;
  }

  if (bootstrap.status === "needs_server" || bootstrap.status === "error") {
    return (
      <ServerConnectScreen
        serverInput={serverInput}
        setServerInput={setServerInput}
        onConnect={async () => {
          await bootstrap.connectToServer(serverInput.trim());
        }}
        error={bootstrap.errorMessage}
      />
    );
  }

  if (auth.phase === "restoring") {
    return <StatusScreen title="Восстанавливаем сессию" message="Подгружаем данные аккаунта..." />;
  }

  if (auth.phase === "two_fa_required") {
    return (
      <TwoFactorScreen
        code={twoFactorCode}
        setCode={setTwoFactorCode}
        onSubmit={async () => {
          await auth.verifyTwoFactor(twoFactorCode.trim());
        }}
        error={auth.errorMessage}
      />
    );
  }

  if (auth.phase !== "authenticated" || !auth.session) {
    return (
      <AuthScreen
        auth={auth}
        authMode={authMode}
        setAuthMode={(mode) => {
          setAuthMode(mode);
          setAuthErrorLocal(null);
          auth.clearError();
        }}
        authErrorLocal={authErrorLocal}
        setAuthErrorLocal={setAuthErrorLocal}
        email={email}
        setEmail={setEmail}
        password={password}
        setPassword={setPassword}
        registerEmail={registerEmail}
        setRegisterEmail={setRegisterEmail}
        registerPassword={registerPassword}
        setRegisterPassword={setRegisterPassword}
        registerPasswordRepeat={registerPasswordRepeat}
        setRegisterPasswordRepeat={setRegisterPasswordRepeat}
      />
    );
  }

  return (
    <main className="app-layout">
      <aside className="app-left-column">
        <div className="brand-block">
          <div className="brand-logo" />
          <div>
            <strong className="brand-name">PWSSocial</strong>
            <p className="muted">Безопасный веб-мессенджер</p>
          </div>
        </div>

        <section className="user-brief-card">
          <div className="avatar-circle">{initialsFromEmail(auth.session.email)}</div>
          <div>
            <strong>{auth.session.email || "Пользователь"}</strong>
            <p className="muted">ID: {shortId(auth.session.accountId)}</p>
          </div>
        </section>

        <nav className="section-nav">
          {MAIN_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`section-nav-item ${activeSection === item.id ? "active" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="section-nav-title">{item.title}</span>
              <span className="section-nav-subtitle">{item.subtitle}</span>
            </button>
          ))}
        </nav>

        <div className="left-actions">
          <button type="button" className="button-secondary" onClick={() => setActiveSection("messages")}>
            Открыть диалоги
          </button>
          <button type="button" className="button-secondary" onClick={() => void auth.logout()}>
            Выйти
          </button>
        </div>
      </aside>

      <section className="app-center-column">
        <header className="page-header-card">
          <div>
            <h1>{pageMeta.title}</h1>
            <p className="muted">{pageMeta.subtitle}</p>
          </div>
          <div className="header-pills">
            <span className={`status-pill ${transport.runtime.status}`}>{transportStatusLabel(transport.runtime.status)}</span>
          </div>
        </header>

        {transportNotice ? (
          <section className={`state-banner ${transportNotice.tone}`}>
            <strong>{transportNotice.title}</strong>
            <p>{transportNotice.text}</p>
          </section>
        ) : null}

        <div className="page-content-shell">
          {activeSection === "home" ? (
            <HomePage
              recentConversations={recentConversations}
              onOpenMessages={() => setActiveSection("messages")}
              onOpenContacts={() => setActiveSection("contacts")}
              onOpenGroups={() => setActiveSection("groups")}
              accountEmail={auth.session.email}
              transportStatus={transport.runtime.status}
              currentAccountId={auth.session.accountId}
            />
          ) : null}

          {activeSection === "messages" ? (
            <MessagesPage
              messaging={messaging}
              currentAccountId={auth.session.accountId}
              chatSearch={chatSearch}
              setChatSearch={setChatSearch}
              filteredConversations={filteredConversations}
              directAccountInput={directAccountInput}
              setDirectAccountInput={setDirectAccountInput}
              createError={createError}
              setCreateError={setCreateError}
            />
          ) : null}

          {activeSection === "contacts" ? (
            <ContactsPage
              contactSearch={contactSearch}
              setContactSearch={setContactSearch}
              contacts={filteredContacts}
              onStartChat={async (accountId) => {
                setActiveSection("messages");
                await messaging.createDirectConversation(accountId);
              }}
            />
          ) : null}

          {activeSection === "groups" ? (
            <GroupsPage
              groups={groups}
              currentAccountId={auth.session.accountId}
              groupTitle={groupTitle}
              setGroupTitle={setGroupTitle}
              groupMembersInput={groupMembersInput}
              setGroupMembersInput={setGroupMembersInput}
              createError={createError}
              setCreateError={setCreateError}
              onCreate={async () => {
                const members = groupMembersInput
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean);
                if (!groupTitle.trim()) {
                  setCreateError("Введите название группы.");
                  return;
                }
                setCreateError(null);
                const createdId = await messaging.createGroupConversation(groupTitle.trim(), members);
                if (!createdId) {
                  setCreateError(messaging.conversationsError ?? "Не удалось создать группу.");
                  return;
                }
                setGroupTitle("");
                setGroupMembersInput("");
                setActiveSection("messages");
                await messaging.selectConversation(createdId);
              }}
              onOpenGroup={async (conversationId) => {
                setActiveSection("messages");
                await messaging.selectConversation(conversationId);
              }}
            />
          ) : null}

          {activeSection === "profile" ? (
            <ProfilePage
              accountId={auth.session.accountId}
              email={auth.session.email}
              twoFactorEnabled={auth.session.twoFactorEnabled}
              recentConversations={recentConversations}
              currentAccountId={auth.session.accountId}
              onOpenSettings={() => setActiveSection("settings")}
            />
          ) : null}

          {activeSection === "settings" ? (
            <SettingsPage
              auth={auth}
              bootstrap={bootstrap}
              transport={transport}
              settingsSection={settingsSection}
              setSettingsSection={setSettingsSection}
              onChangeServer={async () => {
                await auth.logout();
                bootstrap.resetServerConfig();
              }}
            />
          ) : null}
        </div>
      </section>

      <aside className="app-right-column">
        <RightSidebar
          section={activeSection}
          currentAccountId={auth.session.accountId}
          recentConversations={recentConversations}
          selectedConversation={messaging.selectedConversation}
          transport={transport}
          contacts={contacts}
          groups={groups}
        />
      </aside>
    </main>
  );
}

interface StatusScreenProps {
  title: string;
  message: string;
}

function StatusScreen({ title, message }: StatusScreenProps) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{title}</h1>
        <p className="muted">{message}</p>
      </section>
    </main>
  );
}

interface ServerConnectScreenProps {
  serverInput: string;
  setServerInput: (value: string) => void;
  onConnect: () => Promise<void>;
  error: string | null;
}

function ServerConnectScreen({ serverInput, setServerInput, onConnect, error }: ServerConnectScreenProps) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>Подключение к серверу</h1>
        <p className="muted">Введите домен или IP-адрес сервера. Остальные параметры подгрузятся автоматически.</p>
        <form
          className="form-grid"
          onSubmit={async (event) => {
            event.preventDefault();
            await onConnect();
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
        {error ? <div className="error-box">{error}</div> : null}
      </section>
    </main>
  );
}

interface AuthScreenProps {
  auth: AuthState;
  authMode: "register" | "login";
  setAuthMode: (mode: "register" | "login") => void;
  authErrorLocal: string | null;
  setAuthErrorLocal: (value: string | null) => void;
  email: string;
  setEmail: (value: string) => void;
  password: string;
  setPassword: (value: string) => void;
  registerEmail: string;
  setRegisterEmail: (value: string) => void;
  registerPassword: string;
  setRegisterPassword: (value: string) => void;
  registerPasswordRepeat: string;
  setRegisterPasswordRepeat: (value: string) => void;
}

function AuthScreen({
  auth,
  authMode,
  setAuthMode,
  authErrorLocal,
  setAuthErrorLocal,
  email,
  setEmail,
  password,
  setPassword,
  registerEmail,
  setRegisterEmail,
  registerPassword,
  setRegisterPassword,
  registerPasswordRepeat,
  setRegisterPasswordRepeat,
}: AuthScreenProps) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>{authMode === "register" ? "Регистрация" : "Вход"}</h1>
        <p className="muted">Создайте аккаунт или войдите в уже существующий.</p>

        <div className="auth-mode-switch">
          <button type="button" className={`auth-mode-button ${authMode === "register" ? "active" : ""}`} onClick={() => setAuthMode("register")}>
            Регистрация
          </button>
          <button type="button" className={`auth-mode-button ${authMode === "login" ? "active" : ""}`} onClick={() => setAuthMode("login")}>
            Вход
          </button>
        </div>

        {authMode === "register" ? (
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              setAuthErrorLocal(null);
              auth.clearError();
              if (!registerEmail.trim()) {
                setAuthErrorLocal("Введите электронную почту.");
                return;
              }
              if (registerPassword.length < 10) {
                setAuthErrorLocal("Пароль должен быть не короче 10 символов.");
                return;
              }
              if (registerPassword !== registerPasswordRepeat) {
                setAuthErrorLocal("Пароли не совпадают.");
                return;
              }
              await auth.register(registerEmail.trim(), registerPassword);
            }}
          >
            <label>
              Электронная почта
              <input value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} autoComplete="email" autoFocus />
            </label>
            <label>
              Пароль
              <input type="password" value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} autoComplete="new-password" />
            </label>
            <label>
              Повторите пароль
              <input
                type="password"
                value={registerPasswordRepeat}
                onChange={(event) => setRegisterPasswordRepeat(event.target.value)}
                autoComplete="new-password"
              />
            </label>
            <label>
              Режим сессии
              <select
                value={auth.persistenceMode}
                onChange={(event) => auth.setPersistenceMode(event.target.value === "remembered" ? "remembered" : "ephemeral")}
              >
                <option value="ephemeral">Только текущая вкладка</option>
                <option value="remembered">Запомнить на этом устройстве</option>
              </select>
            </label>
            <button type="submit">Создать аккаунт</button>
          </form>
        ) : (
          <form
            className="form-grid"
            onSubmit={async (event) => {
              event.preventDefault();
              setAuthErrorLocal(null);
              auth.clearError();
              await auth.login(email.trim(), password);
            }}
          >
            <label>
              Электронная почта
              <input value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" autoFocus />
            </label>
            <label>
              Пароль
              <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" />
            </label>
            <label>
              Режим сессии
              <select
                value={auth.persistenceMode}
                onChange={(event) => auth.setPersistenceMode(event.target.value === "remembered" ? "remembered" : "ephemeral")}
              >
                <option value="ephemeral">Только текущая вкладка</option>
                <option value="remembered">Запомнить на этом устройстве</option>
              </select>
            </label>
            <button type="submit">Войти</button>
          </form>
        )}

        {authErrorLocal ? <div className="error-box">{authErrorLocal}</div> : null}
        {!authErrorLocal && auth.errorMessage ? <div className="error-box">{auth.errorMessage}</div> : null}
      </section>
    </main>
  );
}

interface TwoFactorScreenProps {
  code: string;
  setCode: (value: string) => void;
  onSubmit: () => Promise<void>;
  error: string | null;
}

function TwoFactorScreen({ code, setCode, onSubmit, error }: TwoFactorScreenProps) {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <h1>Подтверждение входа</h1>
        <p className="muted">Введите шестизначный код из приложения-аутентификатора.</p>
        <form
          className="form-grid"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            await onSubmit();
          }}
        >
          <label>
            Код
            <input value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" autoFocus />
          </label>
          <button type="submit">Подтвердить</button>
        </form>
        {error ? <div className="error-box">{error}</div> : null}
      </section>
    </main>
  );
}

interface HomePageProps {
  recentConversations: ConversationDTO[];
  onOpenMessages: () => void;
  onOpenContacts: () => void;
  onOpenGroups: () => void;
  accountEmail: string;
  transportStatus: TransportState["runtime"]["status"];
  currentAccountId: string;
}

function HomePage({
  recentConversations,
  onOpenMessages,
  onOpenContacts,
  onOpenGroups,
  accountEmail,
  transportStatus,
  currentAccountId,
}: HomePageProps) {
  return (
    <div className="content-stack">
      <section className="surface-card hero-card">
        <h2>Добро пожаловать</h2>
        <p className="muted">Вы вошли как {accountEmail}. Здесь можно быстро перейти к ключевым разделам.</p>
        <div className="inline-actions">
          <button type="button" onClick={onOpenMessages}>
            Открыть сообщения
          </button>
          <button type="button" className="button-secondary" onClick={onOpenContacts}>
            Открыть контакты
          </button>
          <button type="button" className="button-secondary" onClick={onOpenGroups}>
            Открыть группы
          </button>
        </div>
      </section>

      <div className="grid-two">
        <section className="surface-card">
          <div className="row-space">
            <h2>Последние диалоги</h2>
            <span className={`status-pill ${transportStatus}`}>{transportStatusLabel(transportStatus)}</span>
          </div>
          {recentConversations.length === 0 ? (
            <EmptyCard title="Пока нет диалогов" text="Начните личный чат или создайте группу, чтобы здесь появились последние беседы." />
          ) : (
            <div className="compact-list">
              {recentConversations.slice(0, 5).map((conversation) => (
                <article key={conversation.id} className="compact-row">
                  <div>
                    <strong>{buildConversationTitle(conversation, currentAccountId)}</strong>
                    <p className="muted">{conversation.type === "group" ? `${conversation.members.length} участников` : "Личный диалог"}</p>
                  </div>
                  <span className="muted">{formatShortDate(conversation.updatedAt)}</span>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="surface-card">
          <h2>Активность</h2>
          <div className="compact-list">
            <article className="compact-row">
              <div>
                <strong>Подключение</strong>
                <p className="muted">Статус соединения обновляется автоматически.</p>
              </div>
              <span className="muted">Сейчас</span>
            </article>
            <article className="compact-row">
              <div>
                <strong>Безопасность</strong>
                <p className="muted">Проверьте 2FA и активные сессии в настройках.</p>
              </div>
              <span className="muted">Рекомендация</span>
            </article>
            <article className="compact-row">
              <div>
                <strong>Обновления чатов</strong>
                <p className="muted">Новые беседы и сообщения видны в разделе «Сообщения».</p>
              </div>
              <span className="muted">Постоянно</span>
            </article>
          </div>
        </section>
      </div>
    </div>
  );
}

interface MessagesPageProps {
  messaging: MessagingState;
  currentAccountId: string;
  chatSearch: string;
  setChatSearch: (value: string) => void;
  filteredConversations: ConversationDTO[];
  directAccountInput: string;
  setDirectAccountInput: (value: string) => void;
  createError: string | null;
  setCreateError: (value: string | null) => void;
}

function MessagesPage({
  messaging,
  currentAccountId,
  chatSearch,
  setChatSearch,
  filteredConversations,
  directAccountInput,
  setDirectAccountInput,
  createError,
  setCreateError,
}: MessagesPageProps) {
  const sortedMessages = useMemo(
    () => [...messaging.activeMessages].sort((a, b) => a.envelope.serverSequence - b.envelope.serverSequence),
    [messaging.activeMessages],
  );

  return (
    <div className="messages-shell">
      <section className="surface-card conversations-column">
        <div className="row-space">
          <h2>Диалоги</h2>
          <button type="button" className="button-secondary" onClick={() => void messaging.refreshConversations()}>
            Обновить
          </button>
        </div>

        <label className="field-label">
          Поиск
          <input
            value={chatSearch}
            onChange={(event) => setChatSearch(event.target.value)}
            placeholder="Имя, группа или ID"
          />
        </label>

        <div className="conversation-list">
          {messaging.conversationsStatus === "loading"
            ? Array.from({ length: 5 }).map((_, index) => <div key={`conversation-skeleton-${index}`} className="list-skeleton" />)
            : null}

          {messaging.conversationsStatus === "error" ? (
            <div className="error-box">
              {messaging.conversationsError ?? "Не удалось загрузить список диалогов."}
              <div className="inline-actions">
                <button type="button" className="button-secondary" onClick={() => void messaging.refreshConversations()}>
                  Повторить
                </button>
              </div>
            </div>
          ) : null}

          {messaging.conversationsStatus !== "loading" && messaging.conversationsStatus !== "error" && filteredConversations.length === 0 ? (
            <EmptyCard title="Диалогов пока нет" text="Создайте новый чат, чтобы начать переписку." />
          ) : null}

          {messaging.conversationsStatus !== "loading" &&
            filteredConversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`conversation-row ${conversation.id === messaging.selectedConversationId ? "active" : ""}`}
                onClick={() => void messaging.selectConversation(conversation.id)}
              >
                <div className="row-space">
                  <strong>{buildConversationTitle(conversation, currentAccountId)}</strong>
                  <span className="muted">{formatShortDate(conversation.updatedAt)}</span>
                </div>
                <p className="muted">
                  {conversation.type === "group"
                    ? `${conversation.members.length} участников`
                    : `Личный чат · seq ${conversation.lastServerSequence}`}
                </p>
              </button>
            ))}
        </div>

        <div className="surface-subcard">
          <h3>Новый диалог</h3>
          <label className="field-label">
            ID пользователя
            <input
              value={directAccountInput}
              onChange={(event) => setDirectAccountInput(event.target.value)}
              placeholder="Например 2db4c1f0"
            />
          </label>
          <button
            type="button"
            onClick={async () => {
              if (!directAccountInput.trim()) {
                setCreateError("Введите ID пользователя.");
                return;
              }
              setCreateError(null);
              const created = await messaging.createDirectConversation(directAccountInput.trim());
              if (!created) {
                setCreateError(messaging.conversationsError ?? "Не удалось создать диалог.");
                return;
              }
              setDirectAccountInput("");
              await messaging.selectConversation(created);
            }}
          >
            Создать личный чат
          </button>
          {createError ? <div className="error-box">{createError}</div> : null}
        </div>
      </section>

      <section className="surface-card thread-column">
        {!messaging.selectedConversation ? (
          <EmptyCard title="Выберите диалог" text="Откройте чат из списка слева, чтобы увидеть историю сообщений." />
        ) : (
          <>
            <header className="thread-header">
              <div>
                <h2>{buildConversationTitle(messaging.selectedConversation, currentAccountId)}</h2>
                <p className="muted">
                  {messaging.selectedConversation.type === "group"
                    ? `${messaging.selectedConversation.members.length} участников`
                    : "Личный диалог"}
                </p>
              </div>
              <span className="muted">Обновлён {formatShortDate(messaging.selectedConversation.updatedAt)}</span>
            </header>

            <div className="messages-history">
              {messaging.activeMessagesStatus === "loading"
                ? Array.from({ length: 4 }).map((_, index) => <div key={`message-skeleton-${index}`} className="message-skeleton" />)
                : null}

              {messaging.activeMessagesStatus === "error" ? (
                <div className="error-box">
                  {messaging.activeMessagesError ?? "Не удалось загрузить историю сообщений."}
                  <div className="inline-actions">
                    <button type="button" className="button-secondary" onClick={() => void messaging.reloadActiveMessages()}>
                      Повторить
                    </button>
                  </div>
                </div>
              ) : null}

              {messaging.activeMessagesStatus === "ready" && sortedMessages.length === 0 ? (
                <EmptyCard title="История пока пустая" text="Сообщения появятся здесь, когда собеседник начнёт переписку." />
              ) : null}

              {messaging.activeMessagesStatus === "ready" &&
                sortedMessages.map((message) => (
                  <MessageRow key={message.envelope.id} message={message} isOwn={message.envelope.senderAccountId === currentAccountId} />
                ))}
            </div>

            <div className="composer-area">
              <label className="field-label">
                Сообщение
                <textarea
                  rows={3}
                  disabled
                  placeholder="Отправка сообщений появится после завершения криптографической интеграции для веб-версии."
                />
              </label>
              <div className="inline-actions">
                <button type="button" disabled>
                  Отправить
                </button>
                <button type="button" className="button-secondary" onClick={() => void messaging.reloadActiveMessages()}>
                  Обновить историю
                </button>
              </div>
              {messaging.composerDisabledReason ? <p className="muted">{messaging.composerDisabledReason}</p> : null}
            </div>
          </>
        )}
      </section>
    </div>
  );
}

interface MessageRowProps {
  message: MessageDTO;
  isOwn: boolean;
}

function MessageRow({ message, isOwn }: MessageRowProps) {
  return (
    <article className={`message-row ${isOwn ? "own" : ""}`}>
      <div className="message-row-top">
        <strong>{isOwn ? "Вы" : shortId(message.envelope.senderAccountId)}</strong>
        <span className="muted">{formatDateTime(message.envelope.createdAt)}</span>
      </div>
      <p className="message-text">Зашифрованное сообщение</p>
      {message.envelope.attachments.length > 0 ? <p className="muted">Вложений: {message.envelope.attachments.length}</p> : null}
      <div className="row-space">
        <span className={`small-pill ${message.deliveryState}`}>{deliveryStateLabel(message.deliveryState)}</span>
        <span className="muted">seq {message.envelope.serverSequence}</span>
      </div>
      {message.failedReason ? <p className="error-text">Ошибка: {message.failedReason}</p> : null}
    </article>
  );
}

interface ContactsPageProps {
  contactSearch: string;
  setContactSearch: (value: string) => void;
  contacts: Array<{ accountId: string; conversationsCount: number; updatedAt: string }>;
  onStartChat: (accountId: string) => Promise<void>;
}

function ContactsPage({ contactSearch, setContactSearch, contacts, onStartChat }: ContactsPageProps) {
  return (
    <div className="content-stack">
      <section className="surface-card">
        <div className="row-space">
          <h2>Контакты</h2>
          <span className="muted">Всего: {contacts.length}</span>
        </div>
        <label className="field-label">
          Поиск контактов
          <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Введите ID или часть ID" />
        </label>

        {contacts.length === 0 ? (
          <EmptyCard title="Контактов пока нет" text="Контакты появятся автоматически после общения в личных или групповых чатах." />
        ) : (
          <div className="compact-list">
            {contacts.map((contact) => (
              <article key={contact.accountId} className="compact-row">
                <div>
                  <strong>{shortId(contact.accountId)}</strong>
                  <p className="muted">Диалогов: {contact.conversationsCount}</p>
                </div>
                <div className="inline-actions">
                  <span className="muted">{formatShortDate(contact.updatedAt)}</span>
                  <button type="button" className="button-secondary" onClick={() => void onStartChat(contact.accountId)}>
                    Написать
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="grid-two">
        <section className="surface-card">
          <h3>Заявки</h3>
          <EmptyCard title="Пока пусто" text="Здесь будут входящие и исходящие заявки в контакты." />
        </section>
        <section className="surface-card">
          <h3>Рекомендации</h3>
          <p className="muted">По мере развития профиля здесь появятся рекомендации новых контактов.</p>
        </section>
      </div>
    </div>
  );
}

interface GroupsPageProps {
  groups: ConversationDTO[];
  currentAccountId: string;
  groupTitle: string;
  setGroupTitle: (value: string) => void;
  groupMembersInput: string;
  setGroupMembersInput: (value: string) => void;
  createError: string | null;
  setCreateError: (value: string | null) => void;
  onCreate: () => Promise<void>;
  onOpenGroup: (conversationId: string) => Promise<void>;
}

function GroupsPage({
  groups,
  currentAccountId,
  groupTitle,
  setGroupTitle,
  groupMembersInput,
  setGroupMembersInput,
  createError,
  setCreateError,
  onCreate,
  onOpenGroup,
}: GroupsPageProps) {
  return (
    <div className="content-stack">
      <div className="grid-two groups-grid">
        <section className="surface-card">
          <div className="row-space">
            <h2>Мои группы</h2>
            <span className="muted">{groups.length}</span>
          </div>
          {groups.length === 0 ? (
            <EmptyCard title="Групп пока нет" text="Создайте первую группу и пригласите участников." />
          ) : (
            <div className="compact-list">
              {groups.map((group) => (
                <article key={group.id} className="compact-row">
                  <div>
                    <strong>{buildConversationTitle(group, currentAccountId)}</strong>
                    <p className="muted">Участников: {group.members.length}</p>
                  </div>
                  <button type="button" className="button-secondary" onClick={() => void onOpenGroup(group.id)}>
                    Открыть
                  </button>
                </article>
              ))}
            </div>
          )}
        </section>

        <section className="surface-card">
          <h2>Создать группу</h2>
          <p className="muted">Укажите название и список ID участников через запятую.</p>
          <div className="form-grid">
            <label>
              Название
              <input
                value={groupTitle}
                onChange={(event) => {
                  setCreateError(null);
                  setGroupTitle(event.target.value);
                }}
                placeholder="Например: Команда проекта"
              />
            </label>
            <label>
              Участники
              <textarea
                rows={3}
                value={groupMembersInput}
                onChange={(event) => {
                  setCreateError(null);
                  setGroupMembersInput(event.target.value);
                }}
                placeholder="id1, id2, id3"
              />
            </label>
            <button type="button" onClick={() => void onCreate()}>
              Создать группу
            </button>
          </div>
          {createError ? <div className="error-box">{createError}</div> : null}
        </section>
      </div>

      <section className="surface-card">
        <h3>Приглашения</h3>
        <EmptyCard title="Приглашений пока нет" text="Когда вас добавят в группу, приглашение появится здесь." />
      </section>
    </div>
  );
}

interface ProfilePageProps {
  accountId: string;
  email: string;
  twoFactorEnabled: boolean;
  recentConversations: ConversationDTO[];
  currentAccountId: string;
  onOpenSettings: () => void;
}

function ProfilePage({ accountId, email, twoFactorEnabled, recentConversations, currentAccountId, onOpenSettings }: ProfilePageProps) {
  return (
    <div className="content-stack">
      <section className="surface-card profile-card">
        <div className="profile-head">
          <div className="avatar-circle large">{initialsFromEmail(email)}</div>
          <div>
            <h2>{email}</h2>
            <p className="muted">ID аккаунта: {accountId}</p>
          </div>
        </div>
        <div className="inline-actions">
          <button type="button" className="button-secondary" onClick={onOpenSettings}>
            Открыть настройки
          </button>
          <span className={`small-pill ${twoFactorEnabled ? "delivered" : "pending"}`}>
            {twoFactorEnabled ? "2FA включена" : "2FA выключена"}
          </span>
        </div>
      </section>

      <section className="surface-card">
        <h3>Последняя активность</h3>
        {recentConversations.length === 0 ? (
          <EmptyCard title="Пока нет активности" text="После общения здесь появятся последние действия в чатах." />
        ) : (
          <div className="compact-list">
            {recentConversations.slice(0, 5).map((conversation) => (
              <article key={conversation.id} className="compact-row">
                <div>
                  <strong>{buildConversationTitle(conversation, currentAccountId)}</strong>
                  <p className="muted">{conversation.type === "group" ? "Группа" : "Личный чат"}</p>
                </div>
                <span className="muted">{formatShortDate(conversation.updatedAt)}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface SettingsPageProps {
  auth: AuthState;
  bootstrap: BootstrapState;
  transport: TransportState;
  settingsSection: SettingsSection;
  setSettingsSection: (section: SettingsSection) => void;
  onChangeServer: () => Promise<void>;
}

function SettingsPage({ auth, bootstrap, transport, settingsSection, setSettingsSection, onChangeServer }: SettingsPageProps) {
  const selectedTab = SETTINGS_NAV.find((item) => item.id === settingsSection) ?? SETTINGS_NAV[0];

  return (
    <div className="settings-layout">
      <aside className="surface-card settings-nav-card">
        <h2>Настройки</h2>
        <p className="muted">Все системные и защитные параметры находятся в этом разделе.</p>
        <div className="settings-nav-list">
          {SETTINGS_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item ${settingsSection === item.id ? "active" : ""}`}
              onClick={() => setSettingsSection(item.id)}
            >
              <strong>{item.title}</strong>
              <span className="muted">{item.description}</span>
            </button>
          ))}
        </div>
      </aside>

      <section className="surface-card settings-content-card">
        <header className="settings-content-head">
          <h2>{selectedTab.title}</h2>
          <p className="muted">{selectedTab.description}</p>
        </header>

        {settingsSection === "general" ? (
          <SettingsBlock title="Общие параметры">
            <p className="muted">Язык интерфейса: русский. Базовые параметры уже применены для комфортной работы в браузере.</p>
          </SettingsBlock>
        ) : null}

        {settingsSection === "account" ? (
          <SettingsBlock title="Аккаунт">
            <p className="muted">Текущая почта: {auth.session?.email ?? "—"}</p>
            <div className="inline-actions">
              <button type="button" className="button-secondary" onClick={() => void auth.logout()}>
                Выйти из этой сессии
              </button>
              <button type="button" className="button-secondary" onClick={() => void auth.logoutAll()}>
                Выйти со всех устройств
              </button>
            </div>
          </SettingsBlock>
        ) : null}

        {settingsSection === "appearance" ? (
          <SettingsBlock title="Внешний вид">
            <p className="muted">Используется тёмная тема. Вы можете расширить тему в следующих релизах через настройки профиля.</p>
          </SettingsBlock>
        ) : null}

        {settingsSection === "notifications" ? (
          <SettingsBlock title="Уведомления">
            <p className="muted">Системные уведомления будут подключаться через браузерный канал. Сейчас доступен базовый режим внутри интерфейса.</p>
          </SettingsBlock>
        ) : null}

        {settingsSection === "privacy" ? (
          <SettingsBlock title="Конфиденциальность">
            <p className="muted">Публичные данные ограничены. История и сообщения открываются только после авторизации.</p>
          </SettingsBlock>
        ) : null}

        {settingsSection === "security" ? (
          <SettingsBlock title="Безопасность">
            <p className="muted">Двухфакторная защита: {auth.session?.twoFactorEnabled ? "включена" : "выключена"}.</p>
            <p className="muted">Для критичных действий используйте 2FA и периодически проверяйте активные сессии.</p>
          </SettingsBlock>
        ) : null}

        {settingsSection === "devices" ? (
          <SettingsBlock title="Устройства и сессии">
            <p className="muted">Текущий тип сессии: {auth.persistenceMode === "remembered" ? "запомненная" : "временная"}.</p>
            <p className="muted">Платформа клиента: {auth.session?.session.clientPlatform ?? "browser"}.</p>
            <p className="muted">Класс сессии: {auth.session?.session.sessionClass ?? "browser_session"}.</p>
          </SettingsBlock>
        ) : null}

        {settingsSection === "server" ? (
          <SettingsBlock title="Сервер и подключение">
            <p className="muted">Текущий сервер: {bootstrap.serverConfig?.inputHost ?? bootstrap.serverConfig?.apiBaseUrl ?? "не задан"}.</p>
            <p className="muted">Состояние связи: {transportStatusLabel(transport.runtime.status)}.</p>
            <div className="inline-actions">
              <button type="button" className="button-secondary" onClick={transport.reconnect}>
                Обновить подключение
              </button>
              <button type="button" className="button-secondary" onClick={() => void onChangeServer()}>
                Сменить сервер
              </button>
            </div>
          </SettingsBlock>
        ) : null}

        {settingsSection === "data" ? (
          <SettingsBlock title="Данные и хранилище">
            <p className="muted">Секреты сессии хранятся в памяти вкладки. Постоянно сохраняются только безопасные служебные данные.</p>
            <p className="muted">При выходе сессия очищается автоматически.</p>
          </SettingsBlock>
        ) : null}

        {settingsSection === "about" ? (
          <SettingsBlock title="О приложении">
            <p className="muted">PWSSocial Web — веб-клиент безопасного мессенджера.</p>
            <p className="muted">Версия: 1.0.1</p>
          </SettingsBlock>
        ) : null}
      </section>
    </div>
  );
}

interface SettingsBlockProps {
  title: string;
  children: React.ReactNode;
}

function SettingsBlock({ title, children }: SettingsBlockProps) {
  return (
    <section className="settings-block">
      <h3>{title}</h3>
      <div className="content-stack">{children}</div>
    </section>
  );
}

interface RightSidebarProps {
  section: MainSection;
  currentAccountId: string;
  recentConversations: ConversationDTO[];
  selectedConversation: ConversationDTO | null;
  transport: TransportState;
  contacts: Array<{ accountId: string; conversationsCount: number; updatedAt: string }>;
  groups: ConversationDTO[];
}

function RightSidebar({
  section,
  currentAccountId,
  recentConversations,
  selectedConversation,
  transport,
  contacts,
  groups,
}: RightSidebarProps) {
  if (section === "messages") {
    return (
      <div className="content-stack">
        <section className="surface-card">
          <h2>Информация о чате</h2>
          {!selectedConversation ? (
            <EmptyCard title="Чат не выбран" text="Откройте диалог, чтобы увидеть участников и детали." />
          ) : (
            <>
              <p>
                <strong>{buildConversationTitle(selectedConversation, currentAccountId)}</strong>
              </p>
              <p className="muted">Тип: {selectedConversation.type === "group" ? "Группа" : "Личный"}</p>
              <p className="muted">Обновлён: {formatDateTime(selectedConversation.updatedAt)}</p>
              <div className="compact-list members-list">
                {selectedConversation.members.map((member) => (
                  <article key={`${selectedConversation.id}-${member.accountId}`} className="compact-row">
                    <div>
                      <strong>{shortId(member.accountId)}</strong>
                      <p className="muted">Роль: {mapRole(member.role)}</p>
                    </div>
                    <span className="muted">{member.isActive ? "В чате" : "Неактивен"}</span>
                  </article>
                ))}
              </div>
            </>
          )}
        </section>

        <section className="surface-card">
          <h3>Состояние подключения</h3>
          <p className="muted">{transportStatusLabel(transport.runtime.status)}</p>
          <button type="button" className="button-secondary" onClick={transport.reconnect}>
            Повторить подключение
          </button>
        </section>
      </div>
    );
  }

  if (section === "contacts") {
    return (
      <div className="content-stack">
        <section className="surface-card">
          <h2>Кого добавить</h2>
          {contacts.length === 0 ? (
            <EmptyCard title="Пока нет рекомендаций" text="Сначала пообщайтесь в нескольких чатах." />
          ) : (
            <div className="compact-list">
              {contacts.slice(0, 5).map((contact) => (
                <article key={contact.accountId} className="compact-row">
                  <div>
                    <strong>{shortId(contact.accountId)}</strong>
                    <p className="muted">Чатов: {contact.conversationsCount}</p>
                  </div>
                  <span className="muted">{formatShortDate(contact.updatedAt)}</span>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    );
  }

  if (section === "groups") {
    return (
      <div className="content-stack">
        <section className="surface-card">
          <h2>Короткая сводка</h2>
          <p className="muted">Групп: {groups.length}</p>
          <p className="muted">Активная работа с группами доступна в центральной колонке.</p>
        </section>
      </div>
    );
  }

  if (section === "profile") {
    return (
      <div className="content-stack">
        <section className="surface-card">
          <h2>Быстрые действия</h2>
          <div className="compact-list">
            <article className="compact-row">
              <div>
                <strong>Безопасность</strong>
                <p className="muted">Проверьте 2FA и сессии.</p>
              </div>
            </article>
            <article className="compact-row">
              <div>
                <strong>Контакты</strong>
                <p className="muted">Добавьте новых людей в список контактов.</p>
              </div>
            </article>
          </div>
        </section>
      </div>
    );
  }

  if (section === "settings") {
    return (
      <div className="content-stack">
        <section className="surface-card">
          <h2>Подсказка</h2>
          <p className="muted">Все параметры безопасности, устройств и сервера находятся внутри раздела «Настройки».</p>
        </section>
      </div>
    );
  }

  return (
    <div className="content-stack">
      <section className="surface-card">
        <h2>Последние диалоги</h2>
        {recentConversations.length === 0 ? (
          <EmptyCard title="Пока пусто" text="Здесь появятся последние активные беседы." />
        ) : (
          <div className="compact-list">
            {recentConversations.slice(0, 5).map((conversation) => (
              <article key={conversation.id} className="compact-row">
                <div>
                  <strong>{buildConversationTitle(conversation, currentAccountId)}</strong>
                  <p className="muted">{conversation.type === "group" ? "Группа" : "Личный чат"}</p>
                </div>
                <span className="muted">{formatShortDate(conversation.updatedAt)}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

interface EmptyCardProps {
  title: string;
  text: string;
}

function EmptyCard({ title, text }: EmptyCardProps) {
  return (
    <div className="empty-card">
      <strong>{title}</strong>
      <p className="muted">{text}</p>
    </div>
  );
}

function buildConversationTitle(conversation: ConversationDTO, currentAccountId?: string): string {
  if (conversation.title && conversation.title.trim()) {
    return conversation.title.trim();
  }
  if (conversation.type === "group") {
    return `Группа ${shortId(conversation.id)}`;
  }
  const peer = conversation.members.find((member) => member.accountId !== currentAccountId);
  return peer ? `Личный чат с ${shortId(peer.accountId)}` : `Личный чат ${shortId(conversation.id)}`;
}

function mapRole(role: string): string {
  if (role === "owner") {
    return "владелец";
  }
  if (role === "admin") {
    return "администратор";
  }
  return "участник";
}

function initialsFromEmail(email: string): string {
  const [name = "U"] = email.split("@");
  const cleaned = name.replace(/[^a-zA-Zа-яА-Я0-9]/g, "").slice(0, 2);
  return cleaned ? cleaned.toUpperCase() : "U";
}

function shortId(value: string): string {
  if (!value) {
    return "—";
  }
  if (value.length <= 12) {
    return value;
  }
  return `${value.slice(0, 8)}…${value.slice(-4)}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatShortDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  const diffMs = Date.now() - date.getTime();
  const diffHours = Math.floor(diffMs / (60 * 60 * 1000));
  if (diffHours < 1) {
    return "только что";
  }
  if (diffHours < 24) {
    return `${diffHours} ч назад`;
  }

  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
  }).format(date);
}

function deliveryStateLabel(state: MessageDTO["deliveryState"]): string {
  if (state === "delivered") {
    return "Доставлено";
  }
  if (state === "sent") {
    return "Отправлено";
  }
  if (state === "queued") {
    return "В очереди";
  }
  if (state === "failed") {
    return "Ошибка";
  }
  if (state === "expired") {
    return "Истекло";
  }
  return "Ожидает";
}

function transportStatusLabel(status: TransportState["runtime"]["status"]): string {
  if (status === "online") {
    return "Подключено";
  }
  if (status === "connecting") {
    return "Подключаемся";
  }
  if (status === "degraded") {
    return "Связь нестабильна";
  }
  if (status === "forbidden") {
    return "Нужен повторный вход";
  }
  return "Офлайн";
}

function resolveTransportNotice(status: TransportState["runtime"]["status"]):
  | { tone: "warning" | "danger"; title: string; text: string }
  | null {
  if (status === "degraded") {
    return {
      tone: "warning",
      title: "Подключение нестабильно",
      text: "Мы продолжаем синхронизацию через резервный режим. Сообщения могут приходить с задержкой.",
    };
  }

  if (status === "offline" || status === "forbidden") {
    return {
      tone: "danger",
      title: status === "forbidden" ? "Сессия требует обновления" : "Нет подключения к серверу",
      text:
        status === "forbidden"
          ? "Пожалуйста, войдите снова, чтобы восстановить доступ к сообщениям."
          : "Проверьте сеть или настройки сервера в разделе «Настройки» → «Сервер и подключение».",
    };
  }

  return null;
}
