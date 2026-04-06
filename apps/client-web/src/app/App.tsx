import type {
  AuthSessionResponse,
  ConversationDTO,
  CreateSocialPostRequest,
  CreateSocialPostResponse,
  ListConversationsResponse,
  ListSocialPostsResponse,
  LoginSuccessResponse,
  LoginTwoFactorRequiredResponse,
  SocialNotificationsResponse,
  SocialPostLikeResponse,
} from "@project/protocol";
import {
  buildFallbackConfig,
  buildServerConfigEndpoint,
  normalizeServerInput,
  parseServerConfigPayload,
  type ServerBootstrapConfig,
} from "@project/client-core";
import {
  createIndexedDbStateStore,
  createMemorySecretVault,
  createRuntimePlatformAdapter,
} from "@project/platform-adapters";
import React from "react";

import { CreatePost, type CreatePostPayload } from "./components/CreatePost";
import { PostCard } from "./components/PostCard";
import { Sidebar, type SidebarSection } from "./components/Sidebar";

type SessionMode = "ephemeral" | "remembered";
type AuthMode = "login" | "register";

type SavedServer = {
  input: string;
  config: ServerBootstrapConfig;
};

type SessionState = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  email: string;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

const serverKey = "secure-messenger-web-server-v2";
const refreshKey = "secure-messenger-web-refresh-token";
const sessionModeKey = "secure-messenger-web-session-mode";

const vault = createMemorySecretVault();
const stateStore = createIndexedDbStateStore();
const runtime = createRuntimePlatformAdapter();

function App() {
  const [booting, setBooting] = React.useState(true);
  const [server, setServer] = React.useState<SavedServer | null>(null);
  const [sessionMode, setSessionMode] = React.useState<SessionMode>("ephemeral");
  const [session, setSession] = React.useState<SessionState | null>(null);
  const [pending2fa, setPending2fa] = React.useState<LoginTwoFactorRequiredResponse | null>(null);
  const [section, setSection] = React.useState<SidebarSection>("home");

  const [connectError, setConnectError] = React.useState("");
  const [globalError, setGlobalError] = React.useState("");

  const [posts, setPosts] = React.useState<ListSocialPostsResponse["posts"]>([]);
  const [postsLoading, setPostsLoading] = React.useState(false);
  const [postsError, setPostsError] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [mediaType, setMediaType] = React.useState<"all" | "image" | "video">("all");

  const [notifications, setNotifications] = React.useState<SocialNotificationsResponse["notifications"]>([]);
  const [notificationsLoading, setNotificationsLoading] = React.useState(false);
  const [notificationsError, setNotificationsError] = React.useState("");

  const [conversations, setConversations] = React.useState<ConversationDTO[]>([]);
  const [conversationsLoading, setConversationsLoading] = React.useState(false);
  const [conversationsError, setConversationsError] = React.useState("");

  React.useEffect(() => {
    void (async () => {
      const persistedMode = await stateStore.get(sessionModeKey);
      const resolvedMode =
        normalizeSessionMode(persistedMode) ?? (runtime.sessionPolicy.persistence as SessionMode);
      setSessionMode(resolvedMode);

      const savedServer = loadServer();
      if (savedServer) {
        setServer(savedServer);
        const restored = await tryRestore(savedServer.config, resolvedMode);
        if (restored) {
          setSession(restored);
        }
      }

      setBooting(false);
    })();
  }, []);

  React.useEffect(() => {
    if (!session || !server) {
      return;
    }

    if (section === "home") {
      void loadPosts();
      return;
    }
    if (section === "explore") {
      void loadPosts(query, mediaType);
      return;
    }
    if (section === "profile") {
      void loadPosts("", "all", true);
      return;
    }
    if (section === "notifications") {
      void loadNotifications();
      return;
    }
    if (section === "messages") {
      void loadConversations();
    }
  }, [section, session, server, query, mediaType]);

  const connectServer = async (input: string) => {
    setConnectError("");
    setGlobalError("");

    const normalized = normalizeServerInput(input);
    const endpoint = buildServerConfigEndpoint(normalized.origin);
    const config = await loadServerConfig(endpoint, normalized.origin);

    const saved: SavedServer = { input: input.trim(), config };
    localStorage.setItem(serverKey, JSON.stringify(saved));

    await clearAuth();
    setServer(saved);
    setSession(null);
    setPending2fa(null);
    setSection("home");
  };

  const authSubmit = async (mode: AuthMode, email: string, password: string) => {
    if (!server) {
      return;
    }
    setGlobalError("");

    if (mode === "register") {
      const response = await api<LoginSuccessResponse>(server.config, "/auth/web/register", "POST", {
        email,
        password,
        sessionPersistence: sessionMode,
      });
      await applySession(server.config, response, email);
      return;
    }

    const result = await submitWebLogin(server.config, email, password, sessionMode);
    if ("challengeId" in result) {
      setPending2fa(result);
      return;
    }
    await applySession(server.config, result, email);
  };

  const verify2fa = async (code: string) => {
    if (!server || !pending2fa) {
      return;
    }
    setGlobalError("");

    const response = await api<LoginSuccessResponse>(server.config, "/auth/web/2fa/verify", "POST", {
      challengeId: pending2fa.challengeId,
      loginToken: pending2fa.loginToken,
      code,
      sessionPersistence: sessionMode,
    });
    await applySession(server.config, response);
  };

  const applySession = async (
    config: ServerBootstrapConfig,
    response: LoginSuccessResponse,
    fallbackEmail?: string,
  ) => {
    const email = await resolveSessionEmail(config, response.tokens.accessToken, fallbackEmail ?? response.accountId);
    const nextSession: SessionState = {
      accessToken: response.tokens.accessToken,
      refreshToken: response.tokens.refreshToken,
      accountId: response.accountId,
      email,
    };

    await vault.set(refreshKey, nextSession.refreshToken);
    if (sessionMode === "remembered") {
      await stateStore.set(refreshKey, nextSession.refreshToken);
    } else {
      await stateStore.delete(refreshKey);
    }
    await stateStore.set(sessionModeKey, sessionMode);

    setSession(nextSession);
    setPending2fa(null);
    setGlobalError("");
  };

  const authed = async <T,>(
    path: string,
    method: "GET" | "POST" | "DELETE" = "GET",
    body?: unknown,
  ): Promise<T> => {
    if (!server || !session) {
      throw new Error("Нужен вход в аккаунт.");
    }
    return api<T>(server.config, path, method, body, session.accessToken);
  };

  const loadPosts = async (
    search = "",
    filter: "all" | "image" | "video" = "all",
    mine = false,
  ) => {
    setPostsLoading(true);
    setPostsError("");

    try {
      const params = new URLSearchParams({ limit: "30" });
      if (search) {
        params.set("query", search);
      }
      if (filter !== "all") {
        params.set("mediaType", filter);
      }
      if (mine) {
        params.set("scope", "mine");
      }

      const response = await authed<ListSocialPostsResponse>(`/social/posts?${params.toString()}`);
      setPosts(response.posts);
    } catch (error) {
      setPosts([]);
      setPostsError(extractError(error));
    } finally {
      setPostsLoading(false);
    }
  };

  const createPost = async (payload: CreatePostPayload) => {
    const response = await authed<CreateSocialPostResponse>(
      "/social/posts",
      "POST",
      payload as CreateSocialPostRequest,
    );
    setPosts((current) => [response.post, ...current]);
  };

  const toggleLike = async (postId: string, likedByMe: boolean) => {
    const method = likedByMe ? "DELETE" : "POST";
    const response = await authed<SocialPostLikeResponse>(`/social/posts/${postId}/like`, method);
    setPosts((current) =>
      current.map((post) =>
        post.id === postId
          ? { ...post, likeCount: response.likeCount, likedByMe: response.likedByMe }
          : post,
      ),
    );
  };

  const deletePost = async (postId: string) => {
    await authed(`/social/posts/${postId}`, "DELETE");
    setPosts((current) => current.filter((post) => post.id !== postId));
  };

  const loadNotifications = async () => {
    setNotificationsLoading(true);
    setNotificationsError("");

    try {
      const response = await authed<SocialNotificationsResponse>("/social/notifications?limit=20");
      setNotifications(response.notifications);
    } catch (error) {
      setNotifications([]);
      setNotificationsError(extractError(error));
    } finally {
      setNotificationsLoading(false);
    }
  };

  const loadConversations = async () => {
    setConversationsLoading(true);
    setConversationsError("");

    try {
      const response = await authed<ListConversationsResponse>("/conversations");
      setConversations(response.conversations);
    } catch (error) {
      setConversations([]);
      setConversationsError(extractError(error));
    } finally {
      setConversationsLoading(false);
    }
  };

  const logout = async (all = false) => {
    if (!server || !session) {
      return;
    }

    const path = all ? "/auth/web/logout-all" : "/auth/web/logout";
    await api(
      server.config,
      path,
      "POST",
      all ? undefined : { refreshToken: session.refreshToken },
      session.accessToken,
    ).catch(() => undefined);

    await clearAuth();
    setSession(null);
    setPending2fa(null);
    setPosts([]);
    setNotifications([]);
    setConversations([]);
    setGlobalError("");
  };

  const updateSessionMode = async (mode: SessionMode) => {
    setSessionMode(mode);
    await stateStore.set(sessionModeKey, mode);

    if (mode === "ephemeral") {
      await stateStore.delete(refreshKey);
      return;
    }
    if (session) {
      await stateStore.set(refreshKey, session.refreshToken);
    }
  };

  const resetServer = async () => {
    await clearAuth();
    setSession(null);
    setPending2fa(null);
    setServer(null);
    setSection("home");
    setGlobalError("");
    setConnectError("");
  };

  if (booting) {
    return <ShellCard title="Запуск..." subtitle="Проверяем состояние сессии." />;
  }

  if (!server) {
    return (
      <ConnectView
        onConnect={connectServer}
        error={connectError}
        setError={setConnectError}
      />
    );
  }

  if (!session) {
    return (
      <AuthView
        server={server.input}
        mode={sessionMode}
        setMode={setSessionMode}
        pending2fa={pending2fa}
        globalError={globalError}
        onSubmit={authSubmit}
        onVerify2fa={verify2fa}
        onChangeServer={() => void resetServer()}
      />
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--core-background)" }}>
      <div className="mx-auto max-w-[1280px] px-6 py-6 grid grid-cols-[280px_1fr] gap-6">
        <Sidebar activeSection={section} onChange={setSection} />

        <main className="space-y-4">
          <h1 style={{ color: "var(--text-primary)", fontSize: 28, fontWeight: 600 }}>
            {titleBySection[section]}
          </h1>

          {globalError ? <Info text={globalError} tone="error" /> : null}

          {section === "home" ? <CreatePost onSubmit={createPost} /> : null}

          {section === "explore" ? (
            <div
              className="rounded-2xl p-4 border flex gap-3 flex-wrap"
              style={{
                backgroundColor: "var(--glass-fill-base)",
                borderColor: "var(--glass-border)",
              }}
            >
              <input
                className="flex-1 min-w-[220px] bg-transparent rounded-lg px-4 py-2 outline-none border"
                style={{ borderColor: "var(--base-grey-light)", color: "var(--text-primary)" }}
                placeholder="Поиск по тексту поста"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <select
                className="bg-transparent rounded-lg px-4 py-2 outline-none border"
                style={{ borderColor: "var(--base-grey-light)", color: "var(--text-primary)" }}
                value={mediaType}
                onChange={(event) => setMediaType(event.target.value as "all" | "image" | "video")}
              >
                <option value="all">Все</option>
                <option value="image">Фото</option>
                <option value="video">Видео</option>
              </select>
            </div>
          ) : null}

          {section === "profile" ? (
            <Info text={session.email} sub={`ID аккаунта: ${session.accountId}`} />
          ) : null}

          {sectionFeedVisible(section) ? (
            postsLoading ? (
              <Info text="Загружаем ленту..." />
            ) : postsError ? (
              <Info text={postsError} tone="error" />
            ) : posts.length === 0 ? (
              <Info text="Пока нет постов." />
            ) : (
              <div className="space-y-4">
                {posts.map((post) => (
                  <PostCard
                    key={post.id}
                    id={post.id}
                    username={post.authorEmail}
                    timestamp={new Date(post.createdAt).toLocaleString("ru-RU")}
                    imageUrl={post.mediaType === "image" ? post.mediaUrl : null}
                    videoUrl={post.mediaType === "video" ? post.mediaUrl : null}
                    caption={post.content}
                    likes={post.likeCount}
                    likedByMe={post.likedByMe}
                    mood={post.mood}
                    canDelete={post.canDelete}
                    onToggleLike={toggleLike}
                    onDelete={deletePost}
                  />
                ))}
              </div>
            )
          ) : null}

          {section === "notifications" ? (
            notificationsLoading ? (
              <Info text="Загружаем уведомления..." />
            ) : notificationsError ? (
              <Info text={notificationsError} tone="error" />
            ) : notifications.length === 0 ? (
              <Info text="Пока нет уведомлений." />
            ) : (
              <div className="space-y-3">
                {notifications.map((item) => (
                  <Info
                    key={`${item.postId}-${item.actorAccountId}-${item.createdAt}`}
                    text={`${item.actorEmail} поставил(а) лайк вашему посту`}
                    sub={item.postPreview}
                  />
                ))}
              </div>
            )
          ) : null}

          {section === "messages" ? (
            conversationsLoading ? (
              <Info text="Загружаем список чатов..." />
            ) : conversationsError ? (
              <Info text={conversationsError} tone="error" />
            ) : conversations.length === 0 ? (
              <Info text="Пока нет чатов." />
            ) : (
              <div className="space-y-3">
                {conversations.map((conversation) => (
                  <Info
                    key={conversation.id}
                    text={conversation.title ?? "Чат без названия"}
                    sub={`Участников: ${conversation.members.length}`}
                  />
                ))}
              </div>
            )
          ) : null}

          {section === "settings" ? (
            <div
              className="rounded-2xl p-5 border space-y-3"
              style={{
                backgroundColor: "var(--glass-fill-base)",
                borderColor: "var(--glass-border)",
              }}
            >
              <p style={{ color: "var(--base-grey-light)" }}>Сервер: {server.input}</p>
              <p style={{ color: "var(--base-grey-light)" }}>
                Режим сессии: {sessionMode === "ephemeral" ? "Только текущая вкладка" : "Запомнить на устройстве"}
              </p>
              <select
                className="w-full bg-transparent rounded-lg px-4 py-2 outline-none border"
                style={{ borderColor: "var(--base-grey-light)", color: "var(--text-primary)" }}
                value={sessionMode}
                onChange={(event) => void updateSessionMode(event.target.value as SessionMode)}
              >
                <option value="ephemeral">Только текущая вкладка</option>
                <option value="remembered">Запомнить на устройстве</option>
              </select>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border"
                  style={{ borderColor: "var(--accent-brown)", color: "var(--accent-brown)" }}
                  onClick={() => void logout(false)}
                >
                  Выйти
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border"
                  style={{ borderColor: "var(--accent-brown)", color: "var(--accent-brown)" }}
                  onClick={() => void logout(true)}
                >
                  Выйти везде
                </button>
                <button
                  type="button"
                  className="px-4 py-2 rounded-lg border"
                  style={{ borderColor: "var(--accent-brown)", color: "var(--accent-brown)" }}
                  onClick={() => void resetServer()}
                >
                  Сменить сервер
                </button>
              </div>
            </div>
          ) : null}
        </main>
      </div>
    </div>
  );
}

const titleBySection: Record<SidebarSection, string> = {
  home: "Лента",
  explore: "Обзор",
  notifications: "Уведомления",
  messages: "Сообщения",
  profile: "Профиль",
  settings: "Настройки",
};

function ConnectView({
  onConnect,
  error,
  setError,
}: {
  onConnect: (value: string) => Promise<void>;
  error: string;
  setError: (value: string) => void;
}) {
  const [value, setValue] = React.useState("");

  return (
    <ShellCard
      title="Подключение к серверу"
      subtitle="Введите домен или IP адрес вашего сервера."
    >
      <input
        className="w-full bg-transparent rounded-lg px-4 py-3 outline-none border"
        style={{ borderColor: "var(--base-grey-light)", color: "var(--text-primary)" }}
        placeholder="chat.example.com или 89.169.35.49:8080"
        value={value}
        onChange={(event) => setValue(event.target.value)}
      />
      {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
      <button
        type="button"
        className="w-full px-4 py-2 rounded-lg border"
        style={{ borderColor: "var(--accent-brown)", color: "var(--accent-brown)" }}
        onClick={() => void onConnect(value).catch((connectErr) => setError(extractError(connectErr)))}
      >
        Подключиться
      </button>
    </ShellCard>
  );
}

function AuthView({
  server,
  mode,
  setMode,
  pending2fa,
  globalError,
  onSubmit,
  onVerify2fa,
  onChangeServer,
}: {
  server: string;
  mode: SessionMode;
  setMode: (mode: SessionMode) => void;
  pending2fa: LoginTwoFactorRequiredResponse | null;
  globalError: string;
  onSubmit: (mode: AuthMode, email: string, password: string) => Promise<void>;
  onVerify2fa: (code: string) => Promise<void>;
  onChangeServer: () => void;
}) {
  const [authMode, setAuthMode] = React.useState<AuthMode>("login");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [code, setCode] = React.useState("");
  const [error, setError] = React.useState("");

  return (
    <ShellCard title="Вход в веб-версию" subtitle={`Сервер: ${server}`}>
      {pending2fa ? (
        <>
          <input
            className="w-full bg-transparent rounded-lg px-4 py-3 outline-none border"
            style={{ borderColor: "var(--base-grey-light)", color: "var(--text-primary)" }}
            placeholder="Код 2FA"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          <button
            type="button"
            className="w-full px-4 py-2 rounded-lg border"
            style={{ borderColor: "var(--accent-brown)", color: "var(--accent-brown)" }}
            onClick={() => void onVerify2fa(code).catch((verifyErr) => setError(extractError(verifyErr)))}
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
              style={{
                borderColor: "var(--accent-brown)",
                color: authMode === "login" ? "var(--core-background)" : "var(--accent-brown)",
                backgroundColor: authMode === "login" ? "var(--accent-brown)" : "transparent",
              }}
              onClick={() => setAuthMode("login")}
            >
              Вход
            </button>
            <button
              type="button"
              className="px-3 py-1.5 rounded-lg border"
              style={{
                borderColor: "var(--accent-brown)",
                color: authMode === "register" ? "var(--core-background)" : "var(--accent-brown)",
                backgroundColor: authMode === "register" ? "var(--accent-brown)" : "transparent",
              }}
              onClick={() => setAuthMode("register")}
            >
              Регистрация
            </button>
          </div>

          <input
            className="w-full bg-transparent rounded-lg px-4 py-3 outline-none border"
            style={{ borderColor: "var(--base-grey-light)", color: "var(--text-primary)" }}
            placeholder="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
          <input
            type="password"
            className="w-full bg-transparent rounded-lg px-4 py-3 outline-none border"
            style={{ borderColor: "var(--base-grey-light)", color: "var(--text-primary)" }}
            placeholder="Пароль"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <select
            className="w-full bg-transparent rounded-lg px-4 py-2 outline-none border"
            style={{ borderColor: "var(--base-grey-light)", color: "var(--text-primary)" }}
            value={mode}
            onChange={(event) => setMode(event.target.value as SessionMode)}
          >
            <option value="ephemeral">Только текущая вкладка</option>
            <option value="remembered">Запомнить на устройстве</option>
          </select>
          <button
            type="button"
            className="w-full px-4 py-2 rounded-lg border"
            style={{ borderColor: "var(--accent-brown)", color: "var(--accent-brown)" }}
            onClick={() => void onSubmit(authMode, email, password).catch((submitErr) => setError(extractError(submitErr)))}
          >
            {authMode === "login" ? "Войти" : "Создать аккаунт"}
          </button>
        </>
      )}

      <button
        type="button"
        className="text-sm underline"
        style={{ color: "var(--base-grey-light)" }}
        onClick={onChangeServer}
      >
        Сменить сервер
      </button>

      {error ? <p style={{ color: "#fca5a5" }}>{error}</p> : null}
      {globalError ? <p style={{ color: "#fca5a5" }}>{globalError}</p> : null}
    </ShellCard>
  );
}

function ShellCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center px-6" style={{ backgroundColor: "var(--core-background)" }}>
      <div
        className="w-full max-w-[460px] rounded-2xl p-6 border space-y-3"
        style={{ backgroundColor: "var(--glass-fill-base)", borderColor: "var(--glass-border)" }}
      >
        <h1 style={{ color: "var(--text-primary)", fontSize: 28, fontWeight: 600 }}>{title}</h1>
        <p style={{ color: "var(--base-grey-light)" }}>{subtitle}</p>
        {children}
      </div>
    </div>
  );
}

function Info({
  text,
  sub,
  tone = "default",
}: {
  text: string;
  sub?: string;
  tone?: "default" | "error";
}) {
  return (
    <div
      className="rounded-2xl p-4 border"
      style={{ backgroundColor: "var(--glass-fill-base)", borderColor: "var(--glass-border)" }}
    >
      <p style={{ color: tone === "error" ? "#fca5a5" : "var(--text-primary)" }}>{text}</p>
      {sub ? (
        <p className="text-sm mt-1" style={{ color: "var(--base-grey-light)" }}>
          {sub}
        </p>
      ) : null}
    </div>
  );
}

async function submitWebLogin(
  config: ServerBootstrapConfig,
  email: string,
  password: string,
  mode: SessionMode,
): Promise<LoginSuccessResponse | LoginTwoFactorRequiredResponse> {
  const { response, payload } = await requestJSON(config, "/auth/web/login", "POST", {
    email,
    password,
    sessionPersistence: mode,
  });

  if (response.ok) {
    return payload as LoginSuccessResponse;
  }

  if (response.status === 401 && isTwoFactorChallengePayload(payload)) {
    return {
      challengeId: payload.challengeId,
      loginToken: payload.loginToken,
      expiresAt: payload.expiresAt,
    };
  }

  throw new Error(extractApiMessage(payload) ?? "Не удалось выполнить вход.");
}

async function api<T>(
  config: ServerBootstrapConfig,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
  accessToken?: string,
): Promise<T> {
  const { response, payload } = await requestJSON(config, path, method, body, accessToken);
  if (!response.ok) {
    throw new Error(extractApiMessage(payload) ?? "Ошибка запроса");
  }
  return payload as T;
}

async function requestJSON(
  config: ServerBootstrapConfig,
  path: string,
  method: "GET" | "POST" | "DELETE",
  body?: unknown,
  accessToken?: string,
): Promise<{ response: Response; payload: unknown }> {
  const response = await fetch(`${config.apiBaseUrl}${config.apiPrefix}${path}`, {
    method,
    headers: {
      Accept: "application/json",
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

async function loadServerConfig(endpoint: string, origin: string): Promise<ServerBootstrapConfig> {
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "GET" });
  } catch {
    throw new Error("Не удалось подключиться к серверу.");
  }

  if (response.status === 404) {
    return buildFallbackConfig(origin);
  }
  if (!response.ok) {
    throw new Error("Сервер вернул некорректный ответ при загрузке конфигурации.");
  }

  const payload = await response.json().catch(() => null);
  return parseServerConfigPayload(payload);
}

async function resolveSessionEmail(
  config: ServerBootstrapConfig,
  accessToken: string,
  fallbackEmail: string,
): Promise<string> {
  try {
    const response = await api<AuthSessionResponse>(config, "/auth/web/session", "GET", undefined, accessToken);
    return response.email || fallbackEmail;
  } catch {
    return fallbackEmail;
  }
}

async function tryRestore(config: ServerBootstrapConfig, mode: SessionMode): Promise<SessionState | null> {
  try {
    let refreshToken = await vault.get(refreshKey);
    if (!refreshToken && mode === "remembered") {
      refreshToken = await stateStore.get(refreshKey);
    }
    if (!refreshToken) {
      return null;
    }

    const response = await api<LoginSuccessResponse>(config, "/auth/web/refresh", "POST", { refreshToken });
    const email = await resolveSessionEmail(config, response.tokens.accessToken, response.accountId);

    await vault.set(refreshKey, response.tokens.refreshToken);
    if (mode === "remembered") {
      await stateStore.set(refreshKey, response.tokens.refreshToken);
    } else {
      await stateStore.delete(refreshKey);
    }

    return {
      accessToken: response.tokens.accessToken,
      refreshToken: response.tokens.refreshToken,
      accountId: response.accountId,
      email,
    };
  } catch {
    await clearAuth();
    return null;
  }
}

function loadServer(): SavedServer | null {
  const raw = localStorage.getItem(serverKey);
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as SavedServer;
  } catch {
    return null;
  }
}

async function clearAuth() {
  await vault.delete(refreshKey);
  await stateStore.delete(refreshKey);
}

function normalizeSessionMode(value: string | null): SessionMode | null {
  if (value === "ephemeral" || value === "remembered") {
    return value;
  }
  return null;
}

function sectionFeedVisible(section: SidebarSection): boolean {
  return section === "home" || section === "explore" || section === "profile";
}

function isTwoFactorChallengePayload(
  payload: unknown,
): payload is LoginTwoFactorRequiredResponse & ApiErrorPayload {
  if (!payload || typeof payload !== "object") {
    return false;
  }
  const data = payload as Record<string, unknown>;
  return (
    typeof data.challengeId === "string" &&
    typeof data.loginToken === "string" &&
    typeof data.expiresAt === "string" &&
    typeof (data.error as Record<string, unknown> | undefined)?.code === "string"
  );
}

function extractApiMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const source = payload as ApiErrorPayload;
  const message = source.error?.message;
  return typeof message === "string" && message.trim() ? message : null;
}

function extractError(error: unknown): string {
  if (!(error instanceof Error)) {
    return "Произошла ошибка";
  }

  const message = error.message;
  if (
    message.includes("server input is empty") ||
    message.includes("server input is not a valid url") ||
    message.includes("server hostname is required")
  ) {
    return "Проверьте адрес сервера и повторите попытку.";
  }
  if (
    message.includes("server config response has") ||
    message.includes("api_base") ||
    message.includes("ws_url") ||
    message.includes("api_prefix")
  ) {
    return "Сервер вернул некорректную конфигурацию.";
  }
  if (
    message.includes("invalid email or password") ||
    message.includes("invalid credentials")
  ) {
    return "Неверный email или пароль.";
  }
  if (message.includes("account already exists")) {
    return "Аккаунт с таким email уже существует.";
  }
  if (message.includes("two-factor verification is required")) {
    return "Нужен код двухфакторной аутентификации.";
  }
  if (message.includes("post content is required")) {
    return "Введите текст поста.";
  }
  if (message.includes("post content is too long")) {
    return "Текст поста слишком длинный.";
  }
  if (message.includes("media url is invalid") || message.includes("media url must use http/https")) {
    return "Проверьте ссылку на медиа. Нужен корректный URL http/https.";
  }
  if (message.includes("cannot delete social post authored by another account")) {
    return "Можно удалить только свой пост.";
  }
  if (message.includes("social post not found")) {
    return "Пост не найден.";
  }
  if (message.includes("unauthorized")) {
    return "Сессия истекла. Войдите снова.";
  }
  return message;
}

export default App;
