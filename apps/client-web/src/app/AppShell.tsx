import React, { useMemo, useState } from "react";

import type { ConversationDTO, MessageDTO } from "@project/protocol";
import type { SessionPersistenceMode } from "@project/shared-types";

import { useAuth } from "./auth-context";
import { useBootstrap } from "./bootstrap-context";
import { useMessaging } from "./messaging-context";
import { useTransport } from "./transport-context";

type MainSection = "home" | "messages" | "contacts" | "groups" | "profile" | "settings";

const MAIN_NAV: Array<{ id: MainSection; label: string; subtitle: string; icon: string }> = [
  { id: "home", label: "Главная", subtitle: "Лента и обзор", icon: "⌂" },
  { id: "messages", label: "Сообщения", subtitle: "Диалоги и чат", icon: "✉" },
  { id: "contacts", label: "Контакты", subtitle: "Люди и заявки", icon: "◎" },
  { id: "groups", label: "Группы", subtitle: "Сообщества", icon: "◈" },
  { id: "profile", label: "Профиль", subtitle: "О вас", icon: "◉" },
  { id: "settings", label: "Настройки", subtitle: "Параметры", icon: "⚙" },
];

export function AppShell() {
  const bootstrap = useBootstrap();
  const auth = useAuth();
  const messaging = useMessaging();
  const transport = useTransport();

  const [serverInput, setServerInput] = useState(bootstrap.serverConfig?.inputHost ?? "");
  const [authMode, setAuthMode] = useState<"login" | "register">("register");
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [registerEmail, setRegisterEmail] = useState("");
  const [registerPassword, setRegisterPassword] = useState("");
  const [registerPasswordRepeat, setRegisterPasswordRepeat] = useState("");
  const [twoFactorCode, setTwoFactorCode] = useState("");
  const [authLocalError, setAuthLocalError] = useState<string | null>(null);

  const [activeSection, setActiveSection] = useState<MainSection>("home");
  const [chatSearch, setChatSearch] = useState("");
  const [contactSearch, setContactSearch] = useState("");
  const [directPeerInput, setDirectPeerInput] = useState("");
  const [groupTitle, setGroupTitle] = useState("");
  const [groupMembersInput, setGroupMembersInput] = useState("");
  const [conversationActionError, setConversationActionError] = useState<string | null>(null);

  const sortedConversations = useMemo(
    () => [...messaging.conversations].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()),
    [messaging.conversations],
  );

  const recentConversations = useMemo(() => sortedConversations.slice(0, 5), [sortedConversations]);

  const filteredConversations = useMemo(() => {
    const normalized = chatSearch.trim().toLowerCase();
    if (!normalized) {
      return sortedConversations;
    }

    return sortedConversations.filter((conversation) => {
      const title = conversationTitle(conversation, auth.session?.accountId).toLowerCase();
      const participants = conversation.members.map((member) => member.accountId.toLowerCase()).join(" ");
      return title.includes(normalized) || participants.includes(normalized);
    });
  }, [auth.session?.accountId, chatSearch, sortedConversations]);

  const groups = useMemo(() => sortedConversations.filter((conversation) => conversation.type === "group"), [sortedConversations]);

  const contacts = useMemo(() => {
    const currentAccountId = auth.session?.accountId ?? "";
    const map = new Map<string, { accountId: string; chats: number; updatedAt: string }>();

    for (const conversation of sortedConversations) {
      for (const member of conversation.members) {
        if (!member.accountId || member.accountId === currentAccountId) {
          continue;
        }
        const existing = map.get(member.accountId);
        if (existing) {
          existing.chats += 1;
          if (new Date(conversation.updatedAt).getTime() > new Date(existing.updatedAt).getTime()) {
            existing.updatedAt = conversation.updatedAt;
          }
          continue;
        }
        map.set(member.accountId, { accountId: member.accountId, chats: 1, updatedAt: conversation.updatedAt });
      }
    }

    return [...map.values()].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [auth.session?.accountId, sortedConversations]);

  const filteredContacts = useMemo(() => {
    const normalized = contactSearch.trim().toLowerCase();
    if (!normalized) {
      return contacts;
    }
    return contacts.filter((item) => item.accountId.toLowerCase().includes(normalized));
  }, [contactSearch, contacts]);

  if (bootstrap.status === "booting") {
    return <GateScreen title="Запуск приложения" text="Проверяем сохранённые параметры и готовим подключение..." />;
  }

  if (bootstrap.status === "needs_server" || bootstrap.status === "error") {
    return (
      <ServerConnectScreen
        serverInput={serverInput}
        setServerInput={setServerInput}
        error={bootstrap.errorMessage}
        onConnect={async () => {
          await bootstrap.connectToServer(serverInput.trim());
        }}
      />
    );
  }

  if (auth.phase === "restoring") {
    return <GateScreen title="Восстановление сессии" text="Подтягиваем доступ к аккаунту и проверяем токены..." />;
  }

  if (auth.phase === "two_fa_required") {
    return (
      <TwoFactorScreen
        code={twoFactorCode}
        setCode={setTwoFactorCode}
        error={auth.errorMessage}
        onSubmit={async () => {
          if (!twoFactorCode.trim()) {
            return;
          }
          await auth.verifyTwoFactor(twoFactorCode.trim());
        }}
      />
    );
  }

  if (auth.phase !== "authenticated" || !auth.session) {
    return (
      <AuthScreen
        mode={authMode}
        setMode={(mode) => {
          setAuthMode(mode);
          setAuthLocalError(null);
          auth.clearError();
        }}
        loginEmail={loginEmail}
        setLoginEmail={setLoginEmail}
        loginPassword={loginPassword}
        setLoginPassword={setLoginPassword}
        registerEmail={registerEmail}
        setRegisterEmail={setRegisterEmail}
        registerPassword={registerPassword}
        setRegisterPassword={setRegisterPassword}
        registerPasswordRepeat={registerPasswordRepeat}
        setRegisterPasswordRepeat={setRegisterPasswordRepeat}
        authLocalError={authLocalError}
        setAuthLocalError={setAuthLocalError}
        authError={auth.errorMessage}
        persistenceMode={auth.persistenceMode}
        onChangePersistence={auth.setPersistenceMode}
        onRegister={auth.register}
        onLogin={auth.login}
      />
    );
  }

  const session = auth.session;
  const pageMeta = MAIN_NAV.find((item) => item.id === activeSection) ?? MAIN_NAV[0];
  const selectedConversation = messaging.selectedConversation;
  const activeMessages = [...messaging.activeMessages].sort((a, b) => a.envelope.serverSequence - b.envelope.serverSequence);
  const transportNotice = getTransportNotice(transport.runtime.status);

  return (
    <main className="product-shell">
      <aside className="left-rail">
        <section className="glass-card brand-card">
          <div className="brand-dot" />
          <div>
            <strong className="brand-title">PWSSocial</strong>
            <p className="text-muted">Веб-мессенджер</p>
          </div>
        </section>

        <section className="glass-card account-card">
          <div className="avatar-circle">{initials(session.email)}</div>
          <div>
            <strong>{session.email || "Пользователь"}</strong>
            <p className="text-muted">ID: {shortId(session.accountId)}</p>
          </div>
        </section>

        <nav className="nav-list">
          {MAIN_NAV.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`nav-item ${activeSection === item.id ? "active" : ""}`}
              onClick={() => setActiveSection(item.id)}
            >
              <span className="nav-item-icon" aria-hidden="true">{item.icon}</span>
              <span>
                <span className="nav-item-title">{item.label}</span>
                <span className="nav-item-subtitle">{item.subtitle}</span>
              </span>
            </button>
          ))}
        </nav>

        <section className="glass-card quick-actions">
          <button type="button" className="ghost-button" onClick={() => setActiveSection("messages")}>Открыть сообщения</button>
          <button type="button" className="ghost-button" onClick={() => void auth.logout()}>Выйти</button>
        </section>
      </aside>

      <section className="center-pane">
        <header className="glass-card top-header">
          <div>
            <h1>{pageMeta.label}</h1>
            <p className="text-muted">{pageMeta.subtitle}</p>
          </div>
          <span className={`status-chip ${transport.runtime.status}`}>{transportLabel(transport.runtime.status)}</span>
        </header>

        {transportNotice ? (
          <section className={`glass-banner ${transportNotice.tone}`}>
            <strong>{transportNotice.title}</strong>
            <p>{transportNotice.message}</p>
          </section>
        ) : null}

        <section className="content-area">
          {activeSection === "home" ? (
            <section className="glass-card feed-card">
              <h2>С возвращением</h2>
              <p className="text-muted">{session.email}</p>
              <div className="quick-grid">
                <button type="button" className="secondary-button" onClick={() => setActiveSection("messages")}>Открыть сообщения</button>
                <button type="button" className="secondary-button" onClick={() => setActiveSection("contacts")}>Контакты</button>
                <button type="button" className="secondary-button" onClick={() => setActiveSection("groups")}>Группы</button>
              </div>

              <h3>Последние диалоги</h3>
              {recentConversations.length === 0 ? (
                <EmptyState title="Пока пусто" text="Создайте первый чат в разделе «Сообщения»." />
              ) : (
                <div className="stack-list">
                  {recentConversations.map((conversation) => (
                    <article key={conversation.id} className="list-row">
                      <div>
                        <strong>{conversationTitle(conversation, session.accountId)}</strong>
                        <p className="text-muted">{conversation.type === "group" ? "Группа" : "Личный чат"}</p>
                      </div>
                      <span className="text-muted">{formatShortDate(conversation.updatedAt)}</span>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "messages" ? (
            <div className="messages-layout">
              <section className="glass-card conversations-panel">
                <div className="panel-head">
                  <h2>Диалоги</h2>
                  <button type="button" className="tiny-button" onClick={() => setActiveSection("contacts")}>Добавить контакт</button>
                </div>

                <input value={chatSearch} onChange={(event) => setChatSearch(event.target.value)} placeholder="Поиск по чатам" />

                <form
                  className="compact-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!directPeerInput.trim()) {
                      setConversationActionError("Введите UUID пользователя.");
                      return;
                    }
                    setConversationActionError(null);
                    const created = await messaging.createDirectConversation(directPeerInput.trim());
                    if (!created) {
                      setConversationActionError("Не удалось создать личный чат. Проверьте UUID и попробуйте снова.");
                      return;
                    }
                    setDirectPeerInput("");
                  }}
                >
                  <label className="field-label">
                    Личный чат
                    <input value={directPeerInput} onChange={(event) => setDirectPeerInput(event.target.value)} placeholder="UUID пользователя" />
                  </label>
                  <button type="submit">Создать</button>
                </form>

                <form
                  className="compact-form"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!groupTitle.trim()) {
                      setConversationActionError("Введите название группы.");
                      return;
                    }
                    const members = groupMembersInput.split(",").map((item) => item.trim()).filter(Boolean);
                    setConversationActionError(null);
                    const created = await messaging.createGroupConversation(groupTitle.trim(), members);
                    if (!created) {
                      setConversationActionError("Не удалось создать группу. Проверьте участников и повторите.");
                      return;
                    }
                    setGroupTitle("");
                    setGroupMembersInput("");
                  }}
                >
                  <label className="field-label">
                    Новая группа
                    <input value={groupTitle} onChange={(event) => setGroupTitle(event.target.value)} placeholder="Название группы" />
                  </label>
                  <label className="field-label">
                    Участники (через запятую)
                    <input value={groupMembersInput} onChange={(event) => setGroupMembersInput(event.target.value)} placeholder="uuid1, uuid2" />
                  </label>
                  <button type="submit">Создать группу</button>
                </form>

                {conversationActionError ? <p className="error-box">{conversationActionError}</p> : null}

                <div className="conversation-list">
                  {messaging.conversationsStatus === "loading" ? <><div className="skeleton-row" /><div className="skeleton-row" /><div className="skeleton-row" /></> : null}
                  {messaging.conversationsStatus === "error" ? <EmptyState title="Не удалось загрузить диалоги" text="Обновите раздел или проверьте подключение." /> : null}
                  {messaging.conversationsStatus !== "error" && filteredConversations.length === 0 ? <EmptyState title="Диалоги не найдены" text="Начните новый чат или измените поиск." /> : null}

                  {filteredConversations.map((conversation) => (
                    <button
                      key={conversation.id}
                      type="button"
                      className={`conversation-item ${messaging.selectedConversationId === conversation.id ? "active" : ""}`}
                      onClick={() => {
                        void messaging.selectConversation(conversation.id);
                      }}
                    >
                      <div>
                        <strong>{conversationTitle(conversation, session.accountId)}</strong>
                        <p className="text-muted">{conversation.type === "group" ? "Группа" : "Личный чат"}</p>
                      </div>
                      <span className="text-muted">{formatShortDate(conversation.updatedAt)}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="glass-card thread-panel">
                {!selectedConversation ? (
                  <EmptyState title="Выберите диалог" text="Слева выберите чат или создайте новый." />
                ) : (
                  <>
                    <header className="thread-head">
                      <div>
                        <h2>{conversationTitle(selectedConversation, session.accountId)}</h2>
                        <p className="text-muted">{selectedConversation.type === "group" ? "Групповой чат" : "Личный чат"} · участников: {selectedConversation.members.length}</p>
                      </div>
                      <button type="button" className="tiny-button" onClick={() => void messaging.reloadActiveMessages()}>Обновить</button>
                    </header>

                    <div className="history-box">
                      {messaging.activeMessagesStatus === "loading" ? <><div className="message-skeleton" /><div className="message-skeleton" /><div className="message-skeleton" /></> : null}
                      {messaging.activeMessagesStatus === "error" ? <EmptyState title="История не загрузилась" text="Повторите попытку чуть позже." /> : null}
                      {messaging.activeMessagesStatus !== "error" && activeMessages.length === 0 ? <EmptyState title="Пока нет сообщений" text="Этот диалог пока пустой." /> : null}

                      {activeMessages.map((message) => (
                        <article key={message.envelope.id} className={`message-bubble ${message.envelope.senderAccountId === session.accountId ? "own" : ""}`}>
                          <div className="message-top">
                            <strong>{message.envelope.senderAccountId === session.accountId ? "Вы" : shortId(message.envelope.senderAccountId)}</strong>
                            <span className={`mini-chip ${message.deliveryState}`}>{deliveryLabel(message.deliveryState)}</span>
                          </div>
                          <p className="message-body">{cipherPreview(message)}</p>
                          <p className="message-meta">{formatDateTime(message.envelope.createdAt)}</p>
                        </article>
                      ))}
                    </div>

                    <section className="composer-shell">
                      <h3>Сообщение</h3>
                      <textarea disabled placeholder="Отправка в web-версии временно недоступна до полной браузерной криптографии." />
                      <p className="text-muted">{messaging.composerDisabledReason ?? "Отправка временно ограничена. История и синхронизация работают в обычном режиме."}</p>
                    </section>
                  </>
                )}
              </section>
            </div>
          ) : null}

          {activeSection === "contacts" ? (
            <section className="glass-card feed-card">
              <header className="panel-head"><h2>Контакты</h2><p className="text-muted">Ваши собеседники и быстрый старт переписки.</p></header>
              <input value={contactSearch} onChange={(event) => setContactSearch(event.target.value)} placeholder="Поиск по UUID" />
              {filteredContacts.length === 0 ? <EmptyState title="Контактов пока нет" text="После первых диалогов здесь появится список людей." /> : (
                <div className="stack-list">
                  {filteredContacts.map((contact) => (
                    <article key={contact.accountId} className="list-row">
                      <div><strong>{shortId(contact.accountId)}</strong><p className="text-muted">Диалогов: {contact.chats}</p></div>
                      <div className="row-actions"><span className="text-muted">{formatShortDate(contact.updatedAt)}</span><button type="button" className="tiny-button" onClick={async () => { setActiveSection("messages"); await messaging.createDirectConversation(contact.accountId); }}>Написать</button></div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {activeSection === "groups" ? (
            <section className="glass-card feed-card">
              <header className="panel-head"><h2>Группы</h2><p className="text-muted">Список групповых диалогов и быстрый переход в чат.</p></header>
              {groups.length === 0 ? <EmptyState title="Групп пока нет" text="Создайте группу в разделе «Сообщения»." /> : (
                <div className="stack-list">
                  {groups.map((group) => (
                    <article key={group.id} className="list-row">
                      <div><strong>{conversationTitle(group, session.accountId)}</strong><p className="text-muted">Участников: {group.members.length}</p></div>
                      <div className="row-actions"><span className="text-muted">{formatShortDate(group.updatedAt)}</span><button type="button" className="tiny-button" onClick={async () => { setActiveSection("messages"); await messaging.selectConversation(group.id); }}>Открыть</button></div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          ) : null}
          {activeSection === "profile" ? (
            <section className="glass-card feed-card">
              <div className="profile-head">
                <div className="avatar-circle large">{initials(session.email)}</div>
                <div><h2>{session.email || "Пользователь"}</h2><p className="text-muted">{shortId(session.accountId)}</p></div>
              </div>
              <p className="text-muted">Статус 2FA: {session.twoFactorEnabled ? "включена" : "выключена"}.</p>
              <div className="quick-grid">
                <button type="button" className="secondary-button" onClick={() => setActiveSection("settings")}>Настройки безопасности</button>
                <button type="button" className="secondary-button" onClick={() => void auth.logoutAll()}>Выйти со всех устройств</button>
              </div>
            </section>
          ) : null}

          {activeSection === "settings" ? (
            <section className="glass-card feed-card">
              <h2>Настройки</h2>
              <div className="stack-list">
                <article className="list-row"><div><strong>Сервер</strong><p className="text-muted">{bootstrap.serverConfig?.inputHost ?? bootstrap.serverConfig?.apiBaseUrl ?? "не задан"}</p></div></article>
                <article className="list-row"><div><strong>Транспорт</strong><p className="text-muted">{transportLabel(transport.runtime.status)} ({transport.runtime.mode})</p></div></article>
                <article className="list-row"><div><strong>Сессия</strong><p className="text-muted">{auth.persistenceMode === "remembered" ? "запомненная" : "временная"}</p></div></article>
              </div>
              <div className="quick-grid">
                <button type="button" className="secondary-button" onClick={transport.reconnect}>Переподключить</button>
                <button type="button" className="secondary-button" onClick={async () => { await auth.logout(); bootstrap.resetServerConfig(); }}>Сменить сервер</button>
                <button type="button" className="secondary-button" onClick={() => void auth.logout()}>Выйти</button>
                <button type="button" className="secondary-button" onClick={() => void auth.logoutAll()}>Выйти со всех устройств</button>
              </div>
            </section>
          ) : null}
        </section>
      </section>

      <aside className="right-rail">
        <section className="glass-card widget-card">
          <h3>{activeSection === "messages" ? "О чате" : "Сейчас в фокусе"}</h3>
          {activeSection === "messages" ? (
            selectedConversation ? (
              <div className="stack-list">
                <article className="list-row compact"><div><strong>{conversationTitle(selectedConversation, session.accountId)}</strong><p className="text-muted">{selectedConversation.type === "group" ? "Группа" : "Личный чат"}</p></div></article>
                {selectedConversation.members.map((member) => (
                  <article key={`${selectedConversation.id}-${member.accountId}`} className="list-row compact"><div><strong>{shortId(member.accountId)}</strong><p className="text-muted">{roleLabel(member.role)}</p></div></article>
                ))}
              </div>
            ) : (
              <EmptyState title="Чат не выбран" text="Откройте диалог слева, чтобы увидеть детали." />
            )
          ) : (
            <div className="stack-list">
              <article className="list-row compact"><div><strong>#БезопасныеЧаты</strong><p className="text-muted">2.4K обсуждений</p></div></article>
              <article className="list-row compact"><div><strong>#WebMessenger</strong><p className="text-muted">1.9K обсуждений</p></div></article>
              <article className="list-row compact"><div><strong>#SelfHosted</strong><p className="text-muted">1.3K обсуждений</p></div></article>
            </div>
          )}
        </section>

        <section className="glass-card widget-card">
          <h3>Короткая сводка</h3>
          <div className="stack-list">
            <article className="list-row compact"><div><strong>Диалоги</strong><p className="text-muted">{recentConversations.length}</p></div></article>
            <article className="list-row compact"><div><strong>Контакты</strong><p className="text-muted">{contacts.length}</p></div></article>
            <article className="list-row compact"><div><strong>Группы</strong><p className="text-muted">{groups.length}</p></div></article>
          </div>
        </section>
      </aside>
    </main>
  );
}

function GateScreen({ title, text }: { title: string; text: string }) {
  return <main className="gate-shell"><section className="glass-card gate-card"><h1>{title}</h1><p className="text-muted">{text}</p></section></main>;
}

function ServerConnectScreen({ serverInput, setServerInput, onConnect, error }: { serverInput: string; setServerInput: (value: string) => void; onConnect: () => Promise<void>; error: string | null; }) {
  return (
    <main className="gate-shell">
      <section className="glass-card gate-card">
        <h1>Подключение к серверу</h1>
        <p className="text-muted">Введите домен или IP. Остальная конфигурация подгрузится автоматически.</p>
        <form className="form-stack" onSubmit={async (event) => { event.preventDefault(); await onConnect(); }}>
          <label className="field-label">Адрес сервера<input value={serverInput} onChange={(event) => setServerInput(event.target.value)} placeholder="chat.example.com или 89.169.35.49:8080" autoFocus /></label>
          <button type="submit">Подключиться</button>
        </form>
        {error ? <p className="error-box">{error}</p> : null}
      </section>
    </main>
  );
}

function TwoFactorScreen({ code, setCode, onSubmit, error }: { code: string; setCode: (value: string) => void; onSubmit: () => Promise<void>; error: string | null; }) {
  return (
    <main className="gate-shell">
      <section className="glass-card gate-card">
        <h1>Подтверждение 2FA</h1>
        <p className="text-muted">Введите код из приложения-аутентификатора.</p>
        <form className="form-stack" onSubmit={async (event) => { event.preventDefault(); await onSubmit(); }}>
          <label className="field-label">Код<input value={code} onChange={(event) => setCode(event.target.value)} placeholder="123456" autoFocus /></label>
          <button type="submit">Подтвердить</button>
        </form>
        {error ? <p className="error-box">{error}</p> : null}
      </section>
    </main>
  );
}

function AuthScreen({ mode, setMode, loginEmail, setLoginEmail, loginPassword, setLoginPassword, registerEmail, setRegisterEmail, registerPassword, setRegisterPassword, registerPasswordRepeat, setRegisterPasswordRepeat, authLocalError, setAuthLocalError, authError, persistenceMode, onChangePersistence, onRegister, onLogin, }: { mode: "login" | "register"; setMode: (mode: "login" | "register") => void; loginEmail: string; setLoginEmail: (value: string) => void; loginPassword: string; setLoginPassword: (value: string) => void; registerEmail: string; setRegisterEmail: (value: string) => void; registerPassword: string; setRegisterPassword: (value: string) => void; registerPasswordRepeat: string; setRegisterPasswordRepeat: (value: string) => void; authLocalError: string | null; setAuthLocalError: (value: string | null) => void; authError: string | null; persistenceMode: SessionPersistenceMode; onChangePersistence: (mode: SessionPersistenceMode) => void; onRegister: (email: string, password: string) => Promise<boolean>; onLogin: (email: string, password: string) => Promise<boolean>; }) {
  return (
    <main className="gate-shell"><section className="glass-card gate-card"><h1>{mode === "register" ? "Создать аккаунт" : "Вход в аккаунт"}</h1><p className="text-muted">Веб-сессии изолированы от доверенных настольных устройств.</p>
      <div className="auth-switch"><button type="button" className={mode === "register" ? "auth-switch-item active" : "auth-switch-item"} onClick={() => setMode("register")}>Регистрация</button><button type="button" className={mode === "login" ? "auth-switch-item active" : "auth-switch-item"} onClick={() => setMode("login")}>Вход</button></div>
      {mode === "register" ? <form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setAuthLocalError(null); if (!registerEmail.trim() || !registerPassword) { setAuthLocalError("Заполните email и пароль."); return; } if (registerPassword !== registerPasswordRepeat) { setAuthLocalError("Пароли не совпадают."); return; } await onRegister(registerEmail.trim(), registerPassword); }}><label className="field-label">Электронная почта<input value={registerEmail} onChange={(event) => setRegisterEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label><label className="field-label">Пароль<input type="password" value={registerPassword} onChange={(event) => setRegisterPassword(event.target.value)} placeholder="Минимум 8 символов" autoComplete="new-password" /></label><label className="field-label">Повторите пароль<input type="password" value={registerPasswordRepeat} onChange={(event) => setRegisterPasswordRepeat(event.target.value)} placeholder="Повторите пароль" autoComplete="new-password" /></label><SessionModeSelect mode={persistenceMode} setMode={onChangePersistence} /><button type="submit">Создать аккаунт</button></form> : <form className="form-stack" onSubmit={async (event) => { event.preventDefault(); setAuthLocalError(null); if (!loginEmail.trim() || !loginPassword) { setAuthLocalError("Введите email и пароль."); return; } await onLogin(loginEmail.trim(), loginPassword); }}><label className="field-label">Электронная почта<input value={loginEmail} onChange={(event) => setLoginEmail(event.target.value)} placeholder="you@example.com" autoComplete="email" /></label><label className="field-label">Пароль<input type="password" value={loginPassword} onChange={(event) => setLoginPassword(event.target.value)} placeholder="Ваш пароль" autoComplete="current-password" /></label><SessionModeSelect mode={persistenceMode} setMode={onChangePersistence} /><button type="submit">Войти</button></form>}
      {authLocalError ? <p className="error-box">{authLocalError}</p> : null}{authError ? <p className="error-box">{authError}</p> : null}
    </section></main>
  );
}

function SessionModeSelect({ mode, setMode }: { mode: SessionPersistenceMode; setMode: (mode: SessionPersistenceMode) => void }) {
  return <label className="field-label">Режим сессии<select value={mode} onChange={(event) => setMode(event.target.value as SessionPersistenceMode)}><option value="ephemeral">Только текущая вкладка</option><option value="remembered">Запомнить сессию</option></select></label>;
}

function EmptyState({ title, text }: { title: string; text: string }) {
  return <div className="empty-state"><strong>{title}</strong><p className="text-muted">{text}</p></div>;
}

function conversationTitle(conversation: ConversationDTO, currentAccountId?: string): string { if (conversation.title && conversation.title.trim()) { return conversation.title.trim(); } if (conversation.type === "group") { return `Группа ${shortId(conversation.id)}`; } const peer = conversation.members.find((member) => member.accountId !== currentAccountId); return peer ? `Личный чат с ${shortId(peer.accountId)}` : `Личный чат ${shortId(conversation.id)}`; }
function deliveryLabel(state: MessageDTO["deliveryState"]): string { if (state === "delivered") { return "Доставлено"; } if (state === "sent") { return "Отправлено"; } if (state === "queued") { return "В очереди"; } if (state === "failed") { return "Ошибка"; } if (state === "expired") { return "Истекло"; } return "Ожидание"; }
function roleLabel(role: string): string { if (role === "owner") { return "владелец"; } if (role === "admin") { return "администратор"; } return "участник"; }
function transportLabel(status: ReturnType<typeof useTransport>["runtime"]["status"]): string { if (status === "online") { return "Подключено"; } if (status === "connecting") { return "Подключение"; } if (status === "degraded") { return "Нестабильно"; } if (status === "forbidden") { return "Требуется вход"; } return "Офлайн"; }
function getTransportNotice(status: ReturnType<typeof useTransport>["runtime"]["status"]): { tone: "warning" | "danger"; title: string; message: string } | null { if (status === "degraded") { return { tone: "warning", title: "Связь нестабильна", message: "Клиент работает через fallback-режим. Возможны задержки обновления истории." }; } if (status === "offline") { return { tone: "danger", title: "Нет соединения", message: "Проверьте сеть или откройте «Настройки» для переподключения." }; } if (status === "forbidden") { return { tone: "danger", title: "Сессия устарела", message: "Выполните повторный вход, чтобы восстановить доступ к сообщениям." }; } return null; }
function initials(email: string): string { const [name = "U"] = email.split("@"); const cleaned = name.replace(/[^a-zA-Zа-яА-Я0-9]/g, "").slice(0, 2); return cleaned ? cleaned.toUpperCase() : "U"; }
function shortId(value: string): string { if (!value) { return "—"; } if (value.length <= 12) { return value; } return `${value.slice(0, 8)}…${value.slice(-4)}`; }
function formatDateTime(value: string): string { const date = new Date(value); if (Number.isNaN(date.getTime())) { return "—"; } return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date); }
function formatShortDate(value: string): string { const date = new Date(value); if (Number.isNaN(date.getTime())) { return "—"; } const diffMs = Date.now() - date.getTime(); const diffHours = Math.floor(diffMs / (60 * 60 * 1000)); if (diffHours < 1) { return "только что"; } if (diffHours < 24) { return `${diffHours} ч назад`; } return new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit" }).format(date); }
function cipherPreview(message: MessageDTO): string { const source = message.envelope.ciphertext?.trim(); if (!source) { return "Зашифрованное сообщение"; } if (source.length <= 140) { return source; } return `${source.slice(0, 140)}…`; }
