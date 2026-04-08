import type {
  AttachmentMetaDTO,
  AttachmentUploadRequest,
  AuthSessionResponse,
  ConversationDTO,
  ConversationSummaryDTO,
  CreateGroupConversationRequest,
  CreateSocialPostRequest,
  CreateSocialPostResponse,
  DeviceListResponse,
  LoginSuccessResponse,
  LoginTwoFactorRequiredResponse,
  MessageDTO,
  FriendListItemDTO,
  FriendRequestDTO,
  NotificationsResponse,
  PrivacyResponse,
  ProfileDTO,
  SecurityEventsResponse,
  StoryDTO,
  SyncBatchDTO,
  TwoFactorSetupStartResponse,
  UserSearchResponse,
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
import {
  AlertTriangle,
  Download,
  Loader2,
  MessageSquare,
  Paperclip,
  Plus,
  RefreshCcw,
  Search,
  Send,
  Shield,
  User,
  Wifi,
  WifiOff,
  X,
} from "lucide-react";
import React from "react";

import { webCryptoProvider, type RecipientPublicMaterial } from "../features/messaging/crypto";
import { WebMessagingRuntime, type RuntimeTransportState } from "../features/messaging/runtime";
import { ApiClientError, WebApiClient, type WebDevicePayload } from "../shared/api/client";
import { CreatePost, type CreatePostPayload } from "./components/CreatePost";
import { PostCard } from "./components/PostCard";
import { Sidebar, type SidebarSection } from "./components/Sidebar";

type SessionMode = "ephemeral" | "remembered";
type AuthMode = "login" | "register";
type ChatFilter = "all" | "direct" | "group" | "unread";
type SettingsSection = "account" | "sessions" | "devices" | "security" | "privacy" | "app" | "connection";

type SavedServer = {
  input: string;
  config: ServerBootstrapConfig;
};

type SessionState = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  email: string;
  deviceId: string;
};

type DeviceMaterial = {
  name: string;
  platform: string;
  publicKey: string;
  privateKey: string;
};

type AttachmentSecret = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  symmetricKey: string;
  nonce: string;
  checksumSha256: string;
  algorithm: string;
};

type MessageAttachmentView = {
  id: string;
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  algorithm: string;
  nonce: string;
  symmetricKey: string | null;
};

type UploadDraft = {
  id: string;
  file: File;
};

type MessageView = {
  id: string;
  conversationId: string;
  senderAccountId: string;
  createdAt: string;
  serverSequence: number;
  text: string;
  attachments: MessageAttachmentView[];
  own: boolean;
  deliveryState: string;
  localStatus?: "sending" | "failed";
  retryText?: string;
};

type MessageBucket = {
  loading: boolean;
  error: string;
  items: MessageView[];
};

const serverStorageKey = "secure-messenger-web-server-v3";
const refreshTokenStorageKey = "secure-messenger-web-refresh-token";
const sessionModeStorageKey = "secure-messenger-web-session-mode";
const syncCursorStorageKey = "secure-messenger-web-sync-cursor";
const safeStoreTimeoutMs = 1500;
const serverConfigFetchTimeoutMs = 8000;

const secretVault = createMemorySecretVault();
const persistentStore = createIndexedDbStateStore();
const runtimePlatform = createRuntimePlatformAdapter();

const emptyTransportState: RuntimeTransportState = {
  mode: "none",
  status: "offline",
  endpoint: null,
  lastError: null,
  lastCursor: 0,
  updatedAt: new Date().toISOString(),
};

function App() {
  const [booting, setBooting] = React.useState(true);
  const [server, setServer] = React.useState<SavedServer | null>(null);
  const [session, setSession] = React.useState<SessionState | null>(null);
  const [pending2fa, setPending2fa] = React.useState<LoginTwoFactorRequiredResponse | null>(null);
  const [sessionMode, setSessionMode] = React.useState<SessionMode>("ephemeral");

  const [section, setSection] = React.useState<SidebarSection>("messages");
  const [globalError, setGlobalError] = React.useState("");
  const [runtimeError, setRuntimeError] = React.useState("");

  const [transportState, setTransportState] = React.useState<RuntimeTransportState>(emptyTransportState);
  const [summaries, setSummaries] = React.useState<ConversationSummaryDTO[]>([]);
  const [summariesLoading, setSummariesLoading] = React.useState(false);
  const [summariesError, setSummariesError] = React.useState("");
  const [conversationSearch, setConversationSearch] = React.useState("");
  const [conversationFilter, setConversationFilter] = React.useState<ChatFilter>("all");
  const [activeConversationId, setActiveConversationId] = React.useState<string | null>(null);
  const [conversationDetails, setConversationDetails] = React.useState<Record<string, ConversationDTO>>({});
  const [messagesByConversation, setMessagesByConversation] = React.useState<Record<string, MessageBucket>>({});
  const [drafts, setDrafts] = React.useState<Record<string, string>>({});
  const [uploadsByConversation, setUploadsByConversation] = React.useState<Record<string, UploadDraft[]>>({});
  const [unreadByConversation, setUnreadByConversation] = React.useState<Record<string, number>>({});
  const [attachmentOps, setAttachmentOps] = React.useState<Record<string, { loading: boolean; error: string }>>({});

  const [showNewChat, setShowNewChat] = React.useState(false);
  const [userSearchQuery, setUserSearchQuery] = React.useState("");
  const [userSearchResults, setUserSearchResults] = React.useState<UserSearchResponse["users"]>([]);
  const [groupTitle, setGroupTitle] = React.useState("");
  const [groupMembers, setGroupMembers] = React.useState<string[]>([]);
  const [exploreQuery, setExploreQuery] = React.useState("");
  const [exploreLoading, setExploreLoading] = React.useState(false);
  const [exploreHasSearched, setExploreHasSearched] = React.useState(false);
  const [exploreUsers, setExploreUsers] = React.useState<ProfileDTO[]>([]);
  const [explorePosts, setExplorePosts] = React.useState<CreateSocialPostResponse["post"][]>([]);
  const [myProfile, setMyProfile] = React.useState<ProfileDTO | null>(null);
  const [profileTarget, setProfileTarget] = React.useState<ProfileDTO | null>(null);
  const [profileEdit, setProfileEdit] = React.useState({
    displayName: "",
    username: "",
    bio: "",
    statusText: "",
    location: "",
    websiteUrl: "",
  });
  const [profilePosts, setProfilePosts] = React.useState<CreateSocialPostResponse["post"][]>([]);
  const [friends, setFriends] = React.useState<FriendListItemDTO[]>([]);
  const [incomingRequests, setIncomingRequests] = React.useState<FriendRequestDTO[]>([]);
  const [outgoingRequests, setOutgoingRequests] = React.useState<FriendRequestDTO[]>([]);
  const [privacy, setPrivacy] = React.useState<PrivacyResponse["privacy"] | null>(null);
  const [stories, setStories] = React.useState<StoryDTO[]>([]);
  const [storyCaption, setStoryCaption] = React.useState("");
  const [profileLoading, setProfileLoading] = React.useState(false);
  const [settingsSection, setSettingsSection] = React.useState<SettingsSection>("account");
  const [twoFASetup, setTwoFASetup] = React.useState<TwoFactorSetupStartResponse | null>(null);
  const [twoFAEnableCode, setTwoFAEnableCode] = React.useState("");
  const [twoFADisableCode, setTwoFADisableCode] = React.useState("");
  const [settingsMessage, setSettingsMessage] = React.useState("");

  const [posts, setPosts] = React.useState<CreateSocialPostResponse["post"][]>([]);
  const [postsLoading, setPostsLoading] = React.useState(false);
  const [postsError, setPostsError] = React.useState("");
  const [notifications, setNotifications] = React.useState<NotificationsResponse["notifications"]>([]);

  const [sessionInfo, setSessionInfo] = React.useState<AuthSessionResponse | null>(null);
  const [deviceList, setDeviceList] = React.useState<DeviceListResponse | null>(null);
  const [securityEvents, setSecurityEvents] = React.useState<SecurityEventsResponse["events"]>([]);

  const runtimeRef = React.useRef<WebMessagingRuntime | null>(null);
  const deviceMaterialRef = React.useRef<DeviceMaterial | null>(null);
  const messageScrollRef = React.useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);

  const api = React.useMemo(() => (server ? new WebApiClient(server.config) : null), [server]);
  const unreadTotal = React.useMemo(
    () => Object.values(unreadByConversation).reduce((sum, value) => sum + value, 0),
    [unreadByConversation],
  );

  const filteredSummaries = React.useMemo(() => {
    const query = conversationSearch.trim().toLowerCase();
    return summaries
      .filter((item) => {
        if (conversationFilter === "direct" && item.type !== "direct") return false;
        if (conversationFilter === "group" && item.type !== "group") return false;
        if (conversationFilter === "unread" && (unreadByConversation[item.id as string] ?? 0) <= 0) return false;
        if (!query) return true;
        const title = resolveConversationTitle(item).toLowerCase();
        return title.includes(query) || (item.directPeerEmail ?? "").toLowerCase().includes(query);
      })
      .sort((a, b) => b.lastServerSequence - a.lastServerSequence);
  }, [summaries, conversationSearch, conversationFilter, unreadByConversation]);

  const resolveServer = React.useCallback(async (input?: string): Promise<SavedServer> => {
    const source = (input ?? "").trim() || detectDefaultServerInput();
    const normalized = normalizeServerInput(source);
    const config = await fetchServerConfig(normalized.origin);
    return { input: normalized.origin, config };
  }, []);

  React.useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const storedMode = await safeStoreGet(sessionModeStorageKey);
      const mode = normalizeSessionMode(storedMode) ?? (runtimePlatform.sessionPolicy.persistence as SessionMode);
      if (cancelled) return;
      setSessionMode(mode);

      let targetServer = loadSavedServer();
      if (!targetServer) {
        targetServer = await resolveServer();
        localStorage.setItem(serverStorageKey, JSON.stringify(targetServer));
      }
      if (cancelled) return;
      setServer(targetServer);

      const restored = await restoreSession(targetServer.config, mode);
      if (!cancelled && restored) {
        setSession(restored);
      }
      if (!cancelled) {
        setBooting(false);
      }
    };

    void boot().catch((error) => {
      if (!cancelled) {
        setGlobalError(toUserError(error));
        setBooting(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [resolveServer]);

  React.useEffect(() => {
    if (!api || !session) return;
    void loadSummaries(api, session, setSummaries, setSummariesLoading, setSummariesError, setActiveConversationId);
    void loadSettingsData(api, session, setSessionInfo, setDeviceList, setSecurityEvents);
    void loadProfileState(
      api,
      session,
      setMyProfile,
      setProfileEdit,
      setFriends,
      setIncomingRequests,
      setOutgoingRequests,
      setPrivacy,
      setStories,
    );
  }, [api, session?.accessToken]);

  React.useEffect(() => {
    if (!api || !session) return;
    if (section === "feed") {
      void loadFeed(api, session, setPosts, setPostsLoading, setPostsError);
    }
    if (section === "notifications") {
      void loadNotifications(api, session, setNotifications);
    }
    if (section === "profile") {
      void loadProfilePosts(api, session, setProfilePosts, setProfileLoading, profileTarget?.accountId as string | undefined);
    }
  }, [section, api, session?.accessToken, profileTarget?.accountId]);

  React.useEffect(() => {
    if (!api || !session) return;

    let disposed = false;
    const startRuntime = async () => {
      const cursorRaw = await safeStoreGet(syncCursorStorageKey);
      const initialCursor = cursorRaw ? Math.max(0, Number(cursorRaw)) : 0;
      const runtime = new WebMessagingRuntime(api, session.accessToken, {
        onBatch: async (batch) => {
          if (!disposed) {
            await applySyncBatch(
              batch,
              session,
              deviceMaterialRef.current,
              activeConversationId,
              setMessagesByConversation,
              setUnreadByConversation,
            );
            await safeStoreSet(syncCursorStorageKey, String(batch.toCursor));
          }
        },
        onTransport: (state) => {
          if (!disposed) setTransportState(state);
        },
        onError: (message) => {
          if (!disposed) setRuntimeError(message);
        },
      });
      runtimeRef.current = runtime;
      await runtime.start(Number.isFinite(initialCursor) ? initialCursor : 0);
    };

    void startRuntime().catch((error) => {
      if (!disposed) {
        setRuntimeError(toUserError(error));
      }
    });

    return () => {
      disposed = true;
      runtimeRef.current?.stop();
      runtimeRef.current = null;
    };
  }, [api, session?.accessToken, activeConversationId]);

  React.useEffect(() => {
    if (!activeConversationId) return;
    setUnreadByConversation((current) => ({ ...current, [activeConversationId]: 0 }));
    const bucket = messagesByConversation[activeConversationId];
    if (!bucket || bucket.items.length === 0) return;
    const el = messageScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activeConversationId, messagesByConversation]);

  const ensureDeviceMaterial = React.useCallback(async (): Promise<DeviceMaterial> => {
    if (deviceMaterialRef.current) return deviceMaterialRef.current;
    const pair = await webCryptoProvider.generateIdentityKeyPair();
    const device: DeviceMaterial = {
      name: browserDeviceName(),
      platform: "web-browser",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    };
    deviceMaterialRef.current = device;
    return device;
  }, []);

  const resetDeviceMaterial = React.useCallback(() => {
    deviceMaterialRef.current = null;
  }, []);

  const clearSignedInState = React.useCallback(() => {
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    deviceMaterialRef.current = null;
    setSession(null);
    setPending2fa(null);
    setSummaries([]);
    setConversationDetails({});
    setMessagesByConversation({});
    setDrafts({});
    setUploadsByConversation({});
    setUnreadByConversation({});
    setAttachmentOps({});
    setMyProfile(null);
    setProfileTarget(null);
    setProfilePosts([]);
    setFriends([]);
    setIncomingRequests([]);
    setOutgoingRequests([]);
    setPrivacy(null);
    setStories([]);
    setSection("messages");
  }, []);

  const applySession = React.useCallback(
    async (response: LoginSuccessResponse, fallbackEmail?: string) => {
      if (!api) return;
      const sessionResponse = await api.webSession(response.tokens.accessToken).catch(() => null);
      const next: SessionState = {
        accessToken: response.tokens.accessToken,
        refreshToken: response.tokens.refreshToken,
        accountId: response.accountId as string,
        email: sessionResponse?.email ?? fallbackEmail ?? "",
        deviceId: response.device.id as string,
      };

      await secretVault.set(refreshTokenStorageKey, next.refreshToken);
      if (sessionMode === "remembered") {
        await safeStoreSet(refreshTokenStorageKey, next.refreshToken);
      } else {
        await safeStoreDelete(refreshTokenStorageKey);
      }
      await safeStoreSet(sessionModeStorageKey, sessionMode);

      setSession(next);
      setPending2fa(null);
      setSection("messages");
      setGlobalError("");
      setRuntimeError("");
    },
    [api, sessionMode],
  );

  const refreshSessionTokens = React.useCallback(async () => {
    if (!api || !session) {
      return false;
    }
    try {
      const refreshed = await api.refreshWeb(session.refreshToken);
      const profile = await api.webSession(refreshed.tokens.accessToken).catch(() => null);
      const next: SessionState = {
        accessToken: refreshed.tokens.accessToken,
        refreshToken: refreshed.tokens.refreshToken,
        accountId: refreshed.accountId as string,
        email: profile?.email ?? session.email,
        deviceId: refreshed.device.id as string,
      };
      await secretVault.set(refreshTokenStorageKey, next.refreshToken);
      if (sessionMode === "remembered") {
        await safeStoreSet(refreshTokenStorageKey, next.refreshToken);
      }
      setSession(next);
      return true;
    } catch (error) {
      if (error instanceof ApiClientError && (error.status === 401 || error.code === "unauthorized")) {
        await clearAuthState();
        clearSignedInState();
        setGlobalError("Сессия истекла. Войдите снова.");
      }
      return false;
    }
  }, [api, session, sessionMode, clearSignedInState]);

  React.useEffect(() => {
    if (!api || !session) {
      return;
    }
    const refreshInterval = window.setInterval(() => {
      void refreshSessionTokens();
    }, 4 * 60 * 1000);

    return () => {
      window.clearInterval(refreshInterval);
    };
  }, [api, session?.refreshToken, refreshSessionTokens]);

  const submitAuth = async (mode: AuthMode, email: string, password: string) => {
    if (!api) throw new Error("Сначала подключитесь к серверу.");
    const execute = async () => {
      const device = await ensureDeviceMaterial();
      const payload: WebDevicePayload = {
        name: device.name,
        platform: device.platform,
        publicDeviceMaterial: device.publicKey,
      };

      if (mode === "register") {
        const response = await api.registerWeb({ email, password, device: payload, sessionPersistence: sessionMode });
        await applySession(response, email);
        return;
      }

      const response = await api.loginWeb({ email, password, device: payload, sessionPersistence: sessionMode });
      if ("challengeId" in response) {
        setPending2fa(response);
        return;
      }
      await applySession(response, email);
    };

    try {
      await execute();
    } catch (error) {
      if (error instanceof ApiClientError && error.code === "fingerprint_mismatch") {
        resetDeviceMaterial();
        setPending2fa(null);
        await execute();
        return;
      }
      throw error;
    }
  };

  const submit2fa = async (code: string) => {
    if (!api || !pending2fa) throw new Error("Челлендж 2FA не найден.");
    const response = await api.verifyWeb2FA({
      challengeId: pending2fa.challengeId,
      loginToken: pending2fa.loginToken,
      code,
      device: undefined,
      sessionPersistence: sessionMode,
    });
    await applySession(response);
  };

  const logout = async (all: boolean) => {
    if (!api || !session) return;
    try {
      if (all) await api.webLogoutAll(session.accessToken);
      else await api.webLogout(session.accessToken, session.refreshToken);
    } catch {
      // noop
    }

    await clearAuthState();
    clearSignedInState();
  };

  const openConversation = async (conversationId: string) => {
    setActiveConversationId(conversationId);
    setUnreadByConversation((current) => ({ ...current, [conversationId]: 0 }));
    if (!api || !session) return;

    if (!conversationDetails[conversationId]) {
      const details = await api.getConversation(session.accessToken, conversationId);
      setConversationDetails((prev) => ({ ...prev, [conversationId]: details.conversation }));
    }

    if (!messagesByConversation[conversationId]) {
      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationId]: { loading: true, error: "", items: [] },
      }));
      try {
        const history = await api.listConversationMessages(session.accessToken, conversationId, { limit: 60 });
        const decoded = await Promise.all(
          history.messages.map((message) => decodeMessage(message, session, deviceMaterialRef.current)),
        );
        setMessagesByConversation((prev) => ({
          ...prev,
          [conversationId]: {
            loading: false,
            error: "",
            items: decoded.sort((a, b) => a.serverSequence - b.serverSequence),
          },
        }));
      } catch (error) {
        setMessagesByConversation((prev) => ({
          ...prev,
          [conversationId]: { loading: false, error: toUserError(error), items: [] },
        }));
      }
    }
  };

  const sendMessage = async (conversationId: string, retryText?: string) => {
    if (!api || !session) return;
    const text = (retryText ?? drafts[conversationId] ?? "").trim();
    const uploads = uploadsByConversation[conversationId] ?? [];
    if (!text && uploads.length === 0) return;

    const optimisticId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setMessagesByConversation((prev) => {
      const bucket = prev[conversationId] ?? { loading: false, error: "", items: [] };
      return {
        ...prev,
        [conversationId]: {
          ...bucket,
          items: [...bucket.items, {
            id: optimisticId,
            conversationId,
            senderAccountId: session.accountId,
            createdAt: new Date().toISOString(),
            serverSequence: Number.MAX_SAFE_INTEGER,
            text,
            attachments: uploads.map((item) => ({
              id: item.id,
              kind: item.file.type.startsWith("image/") ? "image" : "file",
              fileName: item.file.name,
              mimeType: item.file.type || "application/octet-stream",
              sizeBytes: item.file.size,
              checksumSha256: "",
              algorithm: "xchacha20poly1305_ietf",
              nonce: "",
              symmetricKey: null,
            })),
            own: true,
            deliveryState: "pending",
            localStatus: "sending",
          }],
        },
      };
    });

    try {
      const details = conversationDetails[conversationId] ?? (await api.getConversation(session.accessToken, conversationId)).conversation;
      const recipients = collectRecipients(details.members);
      if (recipients.length === 0) throw new Error("Нет доступных устройств получателей.");
      const attachmentSecrets = await uploadEncryptedAttachments(api, session.accessToken, uploads);
      const plaintextPayload = JSON.stringify({
        text,
        attachments: attachmentSecrets,
        createdAt: new Date().toISOString(),
        replyToMessageId: null,
      });
      const encrypted = await webCryptoProvider.encryptMessage(plaintextPayload, recipients);
      const response = await api.sendMessage(session.accessToken, conversationId, {
        clientMessageId: `web_${Date.now()}_${Math.random().toString(16).slice(2)}`,
        algorithm: encrypted.algorithm,
        cryptoVersion: encrypted.cryptoVersion,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        recipients: encrypted.recipients as never,
        attachmentIds: attachmentSecrets.map((item) => item.attachmentId) as never,
      });

      const mapped = await decodeMessage(response.message, session, deviceMaterialRef.current);
      setMessagesByConversation((prev) => {
        const bucket = prev[conversationId] ?? { loading: false, error: "", items: [] };
        return {
          ...prev,
          [conversationId]: {
            ...bucket,
            items: bucket.items
              .filter((item) => item.id !== optimisticId)
              .concat(mapped)
              .sort((a, b) => a.serverSequence - b.serverSequence),
          },
        };
      });

      setDrafts((prev) => ({ ...prev, [conversationId]: "" }));
      setUploadsByConversation((prev) => ({ ...prev, [conversationId]: [] }));
      void loadSummaries(api, session, setSummaries, setSummariesLoading, setSummariesError, setActiveConversationId);
    } catch (error) {
      setMessagesByConversation((prev) => {
        const bucket = prev[conversationId] ?? { loading: false, error: "", items: [] };
        return {
          ...prev,
          [conversationId]: {
            ...bucket,
            items: bucket.items.map((item) =>
              item.id === optimisticId
                ? { ...item, localStatus: "failed", retryText: text, deliveryState: "failed", attachments: [] }
                : item,
            ),
          },
        };
      });
    }
  };

  const addUpload = (conversationId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const items = Array.from(files).slice(0, 4).map((file) => ({
      id: `upload_${Date.now()}_${Math.random().toString(16).slice(2)}`,
      file,
    }));
    setUploadsByConversation((prev) => ({
      ...prev,
      [conversationId]: [...(prev[conversationId] ?? []), ...items].slice(0, 4),
    }));
  };

  const removeUpload = (conversationId: string, uploadId: string) => {
    setUploadsByConversation((prev) => ({
      ...prev,
      [conversationId]: (prev[conversationId] ?? []).filter((item) => item.id !== uploadId),
    }));
  };

  const downloadAttachment = async (attachment: MessageAttachmentView) => {
    if (!api || !session) return;
    if (!attachment.symmetricKey) {
      setGlobalError("Для этого вложения не найден ключ расшифровки.");
      return;
    }

    setAttachmentOps((prev) => ({ ...prev, [attachment.id]: { loading: true, error: "" } }));
    try {
      const response = await api.downloadAttachment(session.accessToken, attachment.id as never);
      const ciphertextBytes = base64ToBytes(response.ciphertext);
      if (attachment.checksumSha256) {
        const checksum = await webCryptoProvider.hashBytesHex(ciphertextBytes);
        if (checksum.toLowerCase() !== attachment.checksumSha256.toLowerCase()) {
          throw new Error("Контрольная сумма вложения не совпала.");
        }
      }
      const decrypted = await webCryptoProvider.decryptAttachment({
        ciphertext: response.ciphertext,
        nonce: attachment.nonce,
        symmetricKey: attachment.symmetricKey,
      });
      const blobBytes = new Uint8Array(decrypted.byteLength);
      blobBytes.set(decrypted);
      const blob = new Blob([blobBytes.buffer], { type: attachment.mimeType });
      const url = URL.createObjectURL(blob);
      try {
        const element = document.createElement("a");
        element.href = url;
        element.download = attachment.fileName;
        document.body.appendChild(element);
        element.click();
        document.body.removeChild(element);
      } finally {
        URL.revokeObjectURL(url);
      }
      setAttachmentOps((prev) => ({ ...prev, [attachment.id]: { loading: false, error: "" } }));
    } catch (error) {
      setAttachmentOps((prev) => ({
        ...prev,
        [attachment.id]: { loading: false, error: toUserError(error) },
      }));
    }
  };

  const searchUsers = async (query: string) => {
    if (!api || !session) return;
    setUserSearchQuery(query);
    const trimmed = normalizeUserSearchInput(query);
    if (trimmed.length < 2) {
      setUserSearchResults([]);
      return;
    }
    try {
      const response = await api.searchUsers(session.accessToken, trimmed, 20);
      setUserSearchResults(response.users);
    } catch (error) {
      setUserSearchResults([]);
      setGlobalError(toUserError(error));
    }
  };

  const createDirect = async (accountId: string) => {
    if (!api || !session) return;
    const response = await api.createDirectConversation(session.accessToken, accountId as never);
    const conversationId = response.conversation.id as string;
    setShowNewChat(false);
    await loadSummaries(api, session, setSummaries, setSummariesLoading, setSummariesError, setActiveConversationId);
    await openConversation(conversationId);
  };

  const createGroup = async () => {
    if (!api || !session) return;
    const title = groupTitle.trim();
    if (!title || groupMembers.length === 0) {
      setGlobalError("Введите название группы и выберите участников.");
      return;
    }
    const payload: CreateGroupConversationRequest = { title, memberAccountIds: groupMembers as never };
    const response = await api.createGroupConversation(session.accessToken, payload);
    const conversationId = response.conversation.id as string;
    setGroupTitle("");
    setGroupMembers([]);
    setShowNewChat(false);
    await loadSummaries(api, session, setSummaries, setSummariesLoading, setSummariesError, setActiveConversationId);
    await openConversation(conversationId);
  };

  const runExploreSearch = async () => {
    if (!api || !session) return;
    const query = normalizeUserSearchInput(exploreQuery);
    if (query.length < 2) {
      setExploreHasSearched(false);
      setExploreUsers([]);
      setExplorePosts([]);
      return;
    }

    setExploreHasSearched(true);
    setExploreLoading(true);
    try {
      const [profilesResponse, postsResponse] = await Promise.all([
        api.searchProfiles(session.accessToken, query, 20),
        api.listPosts(session.accessToken, { query, limit: 20, mediaType: "all" }),
      ]);
      setExploreUsers(profilesResponse.profiles);
      setExplorePosts(postsResponse.posts);
    } catch (error) {
      setGlobalError(toUserError(error));
    } finally {
      setExploreLoading(false);
    }
  };

  const openUserProfile = async (accountId: string) => {
    if (!api || !session) return;
    try {
      const profileResponse = await api.getUserProfile(session.accessToken, accountId);
      setProfileTarget(profileResponse.profile);
      setSection("profile");
    } catch (error) {
      setGlobalError(toUserError(error));
    }
  };

  const clearProfileTarget = () => {
    setProfileTarget(null);
  };

  const publishPost = async (payload: CreatePostPayload) => {
    if (!api || !session) throw new Error("Сессия не активна.");
    let mediaId: string | undefined;
    if (payload.mediaFile) {
      const uploaded = await api.uploadMedia(session.accessToken, {
        file: payload.mediaFile,
        domain: "social",
        kind: payload.mediaType === "video" ? "video" : "photo",
        visibility: "friends",
      });
      mediaId = uploaded.media.id as string;
    }
    const request: CreateSocialPostRequest = {
      content: payload.content,
      mediaType: payload.mediaType,
      mediaUrl: payload.mediaUrl,
      mediaId: mediaId as never,
      mood: payload.mood,
    };
    const created = await api.createPost(session.accessToken, request);
    setPosts((prev) => [created.post, ...prev]);
  };

  const saveProfile = async () => {
    if (!api || !session) return;
    try {
      const response = await api.updateMyProfile(session.accessToken, {
        displayName: profileEdit.displayName || null,
        username: profileEdit.username || null,
        bio: profileEdit.bio || null,
        statusText: profileEdit.statusText || null,
        location: profileEdit.location || null,
        websiteUrl: profileEdit.websiteUrl || null,
      });
      setMyProfile(response.profile);
      setSettingsMessage("Профиль обновлён.");
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const uploadProfileMedia = async (file: File, kind: "avatar" | "banner") => {
    if (!api || !session) return;
    try {
      const uploaded = await api.uploadMedia(session.accessToken, {
        file,
        domain: "profile",
        kind,
        visibility: "public",
      });
      const response = await api.updateMyProfile(session.accessToken, {
        avatarMediaId: kind === "avatar" ? uploaded.media.id : undefined,
        bannerMediaId: kind === "banner" ? uploaded.media.id : undefined,
      });
      setMyProfile(response.profile);
      setSettingsMessage(kind === "avatar" ? "Аватар обновлён." : "Обложка обновлена.");
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const createStory = async (file: File) => {
    if (!api || !session) return;
    try {
      const uploaded = await api.uploadMedia(session.accessToken, {
        file,
        domain: "story",
        kind: file.type.startsWith("video/") ? "story_video" : "story_image",
        visibility: "friends",
      });
      await api.createStory(session.accessToken, {
        mediaId: uploaded.media.id,
        caption: storyCaption.trim() || undefined,
        visibility: "friends",
      });
      setStoryCaption("");
      const feed = await api.listStoryFeed(session.accessToken, 60);
      setStories(feed.stories);
      setSettingsMessage("История опубликована.");
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const sendFriendRequest = async (accountId: string) => {
    if (!api || !session) return;
    try {
      await api.createFriendRequest(session.accessToken, { targetAccountId: accountId as never });
      setExploreUsers((current) =>
        current.map((item) =>
          (item.accountId as string) === accountId
            ? { ...item, friendState: "outgoing_request", canSendFriendRequest: false }
            : item,
        ),
      );
      await loadProfileState(
        api,
        session,
        setMyProfile,
        setProfileEdit,
        setFriends,
        setIncomingRequests,
        setOutgoingRequests,
        setPrivacy,
        setStories,
      );
      if (profileTarget && profileTarget.accountId === (accountId as never)) {
        const refreshed = await api.getUserProfile(session.accessToken, accountId);
        setProfileTarget(refreshed.profile);
      }
      setSettingsMessage("Заявка в друзья отправлена.");
    } catch (error) {
      setGlobalError(toUserError(error));
    }
  };

  const processFriendRequest = async (
    requestId: string,
    action: "accept" | "reject" | "cancel",
    accountIdToRefresh?: string,
  ) => {
    if (!api || !session) return;
    try {
      if (action === "accept") {
        await api.acceptFriendRequest(session.accessToken, requestId);
      } else if (action === "reject") {
        await api.rejectFriendRequest(session.accessToken, requestId);
      } else {
        await api.cancelFriendRequest(session.accessToken, requestId);
      }
      await loadProfileState(
        api,
        session,
        setMyProfile,
        setProfileEdit,
        setFriends,
        setIncomingRequests,
        setOutgoingRequests,
        setPrivacy,
        setStories,
      );
      if (accountIdToRefresh) {
        const refreshed = await api.getUserProfile(session.accessToken, accountIdToRefresh);
        setProfileTarget(refreshed.profile);
      }
    } catch (error) {
      setGlobalError(toUserError(error));
    }
  };

  const removeFriend = async (accountId: string) => {
    if (!api || !session) return;
    try {
      await api.removeFriend(session.accessToken, accountId);
      await loadProfileState(
        api,
        session,
        setMyProfile,
        setProfileEdit,
        setFriends,
        setIncomingRequests,
        setOutgoingRequests,
        setPrivacy,
        setStories,
      );
      if (profileTarget && profileTarget.accountId === (accountId as never)) {
        const refreshed = await api.getUserProfile(session.accessToken, accountId);
        setProfileTarget(refreshed.profile);
      }
    } catch (error) {
      setGlobalError(toUserError(error));
    }
  };

  const toggleLike = async (postId: string, likedByMe: boolean) => {
    if (!api || !session) return;
    const response = await api.togglePostLike(session.accessToken, postId as never, likedByMe);
    const patchLike = (post: CreateSocialPostResponse["post"]) =>
      (post.id as string) === postId ? { ...post, likeCount: response.likeCount, likedByMe: response.likedByMe } : post;
    setPosts((prev) => prev.map(patchLike));
    setExplorePosts((prev) => prev.map(patchLike));
    setProfilePosts((prev) => prev.map(patchLike));
  };

  const deletePost = async (postId: string) => {
    if (!api || !session) return;
    await api.deletePost(session.accessToken, postId as never);
    setPosts((prev) => prev.filter((post) => (post.id as string) !== postId));
    setExplorePosts((prev) => prev.filter((post) => (post.id as string) !== postId));
    setProfilePosts((prev) => prev.filter((post) => (post.id as string) !== postId));
  };

  const startTwoFactorSetup = async () => {
    if (!api || !session) return;
    try {
      const setup = await api.startTwoFA(session.accessToken);
      setTwoFASetup(setup);
      setSettingsMessage("Секрет создан. Введите код из приложения-аутентификатора.");
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const confirmTwoFactorSetup = async () => {
    if (!api || !session || !twoFAEnableCode.trim()) return;
    try {
      await api.confirmTwoFA(session.accessToken, twoFAEnableCode.trim());
      setTwoFAEnableCode("");
      setTwoFASetup(null);
      setSettingsMessage("2FA успешно включена.");
      await loadSettingsData(api, session, setSessionInfo, setDeviceList, setSecurityEvents);
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const disableTwoFactor = async () => {
    if (!api || !session || !twoFADisableCode.trim()) return;
    try {
      await api.disableTwoFA(session.accessToken, twoFADisableCode.trim());
      setTwoFADisableCode("");
      setTwoFASetup(null);
      setSettingsMessage("2FA отключена.");
      await loadSettingsData(api, session, setSessionInfo, setDeviceList, setSecurityEvents);
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const revokeDevice = async (deviceId: string) => {
    if (!api || !session) return;
    try {
      await api.revokeDevice(session.accessToken, deviceId);
      setSettingsMessage("Устройство отозвано.");
      await loadSettingsData(api, session, setSessionInfo, setDeviceList, setSecurityEvents);
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const testConnection = async () => {
    if (!api || !server) return;
    try {
      await fetch(buildServerConfigEndpoint(server.config.apiBaseUrl), { method: "GET" });
      setSettingsMessage("Соединение с сервером успешно.");
    } catch {
      setSettingsMessage("Не удалось проверить соединение с сервером.");
    }
  };

  const resetServer = async () => {
    await clearAuthState();
    localStorage.removeItem(serverStorageKey);
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    setServer(null);
    setSession(null);
    setPending2fa(null);
    setUnreadByConversation({});
    setMessagesByConversation({});
    setSummaries([]);
    setMyProfile(null);
    setProfileTarget(null);
    setProfilePosts([]);
    setFriends([]);
    setIncomingRequests([]);
    setOutgoingRequests([]);
    setPrivacy(null);
    setStories([]);
    setSection("messages");
    try {
      const next = await resolveServer();
      localStorage.setItem(serverStorageKey, JSON.stringify(next));
      setServer(next);
      setGlobalError("");
    } catch (error) {
      setServer(null);
      setGlobalError(toUserError(error));
    }
  };

  const activeBucket = activeConversationId ? messagesByConversation[activeConversationId] : undefined;
  const viewedProfile = profileTarget ?? myProfile;

  if (booting) {
    return <StandaloneCard title="Запуск приложения" subtitle="Проверяем сервер и сессию..." />;
  }

  if (!server) {
    return (
      <AutoConnectScreen
        error={globalError}
        onRetry={async () => {
          setGlobalError("");
          try {
            const next = await resolveServer();
            localStorage.setItem(serverStorageKey, JSON.stringify(next));
            setServer(next);
          } catch (error) {
            setGlobalError(toUserError(error));
          }
        }}
      />
    );
  }

  if (!session) {
    return (
      <AuthScreen
        server={server.input}
        mode={sessionMode}
        pending2fa={pending2fa}
        error={globalError}
        onModeChange={async (mode) => {
          setSessionMode(mode);
          await safeStoreSet(sessionModeStorageKey, mode);
        }}
        onSubmit={async (mode, email, password) => {
          setGlobalError("");
          try {
            await submitAuth(mode, email, password);
          } catch (error) {
            setGlobalError(toUserError(error));
          }
        }}
        onVerify={async (code) => {
          setGlobalError("");
          try {
            await submit2fa(code);
          } catch (error) {
            setGlobalError(toUserError(error));
          }
        }}
        onChangeServer={resetServer}
      />
    );
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--core-background)" }}>
      <div className="mx-auto max-w-[1440px] px-5 py-5 grid grid-cols-[280px_1fr] gap-5">
        <Sidebar
          activeSection={section}
          onChange={setSection}
          badges={{ notifications: notifications.length, messages: unreadTotal }}
        />

        <main className="space-y-4">
          <header className="flex items-center justify-between rounded-2xl border px-4 py-3" style={cardStyle}>
            <div>
              <h1 style={{ color: "var(--text-primary)", fontSize: 26, fontWeight: 600 }}>{sectionTitle(section)}</h1>
              <p style={{ color: "var(--base-grey-light)", fontSize: 14 }}>{sectionSubtitle(section, server.input, transportState)}</p>
            </div>
            <StatusChip state={transportState.status} />
          </header>

          {runtimeError ? <InlineInfo tone="warning" text={runtimeError} /> : null}
          {globalError ? <InlineInfo tone="error" text={globalError} /> : null}

          {section === "messages" ? (
            <section className="grid gap-4 grid-cols-[320px_1fr_280px] h-[calc(100vh-170px)] min-h-[620px]">
              <aside className="rounded-2xl border p-4 overflow-hidden flex flex-col" style={cardStyle}>
                <div className="flex items-center gap-2 mb-3">
                  <Search className="w-4 h-4" style={{ color: "var(--base-grey-light)" }} />
                  <input value={conversationSearch} onChange={(e) => setConversationSearch(e.target.value)} placeholder="Поиск по чатам" className="w-full bg-transparent outline-none" style={{ color: "var(--text-primary)" }} />
                </div>
                <div className="flex gap-2 mb-3 flex-wrap">
                  {(["all", "direct", "group", "unread"] as ChatFilter[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      className="px-2 py-1 rounded-lg border text-xs"
                      style={conversationFilter === value ? solidButtonStyle : outlineButtonStyle}
                      onClick={() => setConversationFilter(value)}
                    >
                      {value === "all"
                        ? "Все"
                        : value === "direct"
                          ? "Личные"
                          : value === "group"
                            ? "Группы"
                            : "Непрочитанные"}
                    </button>
                  ))}
                </div>
                <button type="button" className="mb-3 px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => setShowNewChat((v) => !v)}>
                  <Plus className="w-4 h-4 inline mr-2" />Новый чат
                </button>

                {showNewChat ? (
                  <div className="rounded-xl border p-3 mb-3 space-y-3" style={innerCardStyle}>
                    <input value={userSearchQuery} onChange={(e) => void searchUsers(e.target.value)} placeholder="Поиск пользователя" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                    <div className="space-y-2 max-h-40 overflow-auto">
                      {userSearchResults.map((user) => {
                        const accountId = user.accountId as string;
                        const selected = groupMembers.includes(accountId);
                        return (
                          <div key={accountId} className="rounded-lg border p-2" style={innerCardStyle}>
                            <p style={{ color: "var(--text-primary)", fontSize: 13 }}>
                              {user.displayName || user.username || "Пользователь"}
                            </p>
                            <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>@{user.username}</p>
                            <div className="flex gap-2 mt-2">
                              <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void createDirect(accountId)}>Личный</button>
                              <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={selected ? solidButtonStyle : outlineButtonStyle} onClick={() => setGroupMembers((prev) => (prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId]))}>{selected ? "Выбран" : "В группу"}</button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <input value={groupTitle} onChange={(e) => setGroupTitle(e.target.value)} placeholder="Название группы" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                    <button type="button" className="w-full rounded-lg border px-3 py-2" style={outlineButtonStyle} onClick={() => void createGroup()}>Создать группу</button>
                  </div>
                ) : null}

                {summariesLoading ? <InlineInfo text="Загрузка чатов..." /> : null}
                {summariesError ? <InlineInfo tone="error" text={summariesError} /> : null}
                <div className="space-y-2 overflow-auto">
                  {filteredSummaries.map((item) => {
                    const id = item.id as string;
                    const selected = activeConversationId === id;
                    const unread = unreadByConversation[id] ?? 0;
                    return (
                      <button key={id} type="button" className="w-full text-left rounded-xl border p-3" style={selected ? selectedCardStyle : innerCardStyle} onClick={() => void openConversation(id)}>
                        <div className="flex items-center justify-between gap-2">
                          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>{resolveConversationTitle(item)}</p>
                          {unread > 0 ? (
                            <span className="px-2 py-0.5 rounded-full text-xs" style={{ backgroundColor: "var(--accent-brown)", color: "var(--core-background)" }}>
                              {unread > 99 ? "99+" : unread}
                            </span>
                          ) : null}
                        </div>
                        <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                          {item.lastMessage ? new Date(item.lastMessage.createdAt as string).toLocaleString("ru-RU") : "Без сообщений"}
                        </p>
                      </button>
                    );
                  })}
                </div>
              </aside>

              <section className="rounded-2xl border overflow-hidden flex flex-col" style={cardStyle}>
                {!activeConversationId ? (
                  <div className="h-full flex items-center justify-center"><InlineInfo text="Выберите чат слева" /></div>
                ) : (
                  <>
                    <header className="px-4 py-3 border-b flex items-center justify-between" style={{ borderColor: "var(--glass-border)" }}>
                      <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>{resolveConversationTitle(summaries.find((item) => (item.id as string) === activeConversationId) ?? null)}</p>
                      <button type="button" className="px-3 py-1.5 rounded-lg border text-sm" style={outlineButtonStyle} onClick={() => api ? void loadSummaries(api, session, setSummaries, setSummariesLoading, setSummariesError, setActiveConversationId) : undefined}><RefreshCcw className="w-4 h-4 inline mr-2" />Обновить</button>
                    </header>
                    <div ref={messageScrollRef} className="flex-1 overflow-auto px-4 py-4 space-y-3">
                      {activeBucket?.loading ? <InlineInfo text="Загрузка истории..." /> : null}
                      {activeBucket?.error ? <InlineInfo tone="error" text={activeBucket.error} /> : null}
                      {activeBucket && activeBucket.items.length === 0 ? <InlineInfo text="В чате пока нет сообщений." /> : null}
                      {activeBucket?.items.map((message) => (
                        <MessageRow
                          key={message.id}
                          message={message}
                          onResend={message.localStatus === "failed" ? async () => sendMessage(activeConversationId, message.retryText) : undefined}
                          onDownloadAttachment={downloadAttachment}
                          attachmentOpState={attachmentOps}
                        />
                      ))}
                    </div>
                    <footer className="border-t p-4 space-y-2" style={{ borderColor: "var(--glass-border)" }}>
                      <input
                        ref={attachmentInputRef}
                        type="file"
                        className="hidden"
                        multiple
                        onChange={(event) => {
                          addUpload(activeConversationId, event.target.files);
                          event.currentTarget.value = "";
                        }}
                      />
                      <textarea value={drafts[activeConversationId] ?? ""} onChange={(e) => setDrafts((prev) => ({ ...prev, [activeConversationId]: e.target.value }))} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void sendMessage(activeConversationId); } }} placeholder="Введите сообщение" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none resize-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)", minHeight: 84 }} />
                      {(uploadsByConversation[activeConversationId] ?? []).length > 0 ? (
                        <div className="space-y-2">
                          {(uploadsByConversation[activeConversationId] ?? []).map((upload) => (
                            <div key={upload.id} className="flex items-center justify-between rounded-lg border px-3 py-2" style={innerCardStyle}>
                              <div>
                                <p style={{ color: "var(--text-primary)" }}>{upload.file.name}</p>
                                <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>{formatBytes(upload.file.size)}</p>
                              </div>
                              <button type="button" className="p-1 rounded border" style={outlineButtonStyle} onClick={() => removeUpload(activeConversationId, upload.id)}>
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="px-3 py-2 rounded-lg border"
                          style={outlineButtonStyle}
                          onClick={() => attachmentInputRef.current?.click()}
                        >
                          <Paperclip className="w-4 h-4 inline mr-2" />
                          Вложение
                        </button>
                        <button type="button" className="px-4 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void sendMessage(activeConversationId)}><Send className="w-4 h-4 inline mr-2" />Отправить</button>
                      </div>
                    </footer>
                  </>
                )}
              </section>

              <aside className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                <h3 style={{ color: "var(--text-primary)", fontWeight: 600 }}>Подключение</h3>
                <TransportCard state={transportState} />
                <div className="rounded-xl border p-3" style={innerCardStyle}><p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Сервер</p><p style={{ color: "var(--text-primary)", wordBreak: "break-all" }}>{server.input}</p></div>
              </aside>
            </section>
          ) : null}

          {section === "feed" ? (
            <section className="space-y-4">
              <CreatePost onSubmit={publishPost} />
              {postsLoading ? <InlineInfo text="Загрузка ленты..." /> : null}
              {postsError ? <InlineInfo tone="error" text={postsError} /> : null}
              {posts.map((post) => (
                <PostCard
                  key={post.id as string}
                  id={post.id as string}
                  authorDisplayName={post.authorDisplayName || post.authorUsername || post.authorEmail}
                  authorUsername={post.authorUsername}
                  timestamp={new Date(post.createdAt as string).toLocaleString("ru-RU")}
                  imageUrl={post.mediaType === "image" ? post.mediaUrl : null}
                  videoUrl={post.mediaType === "video" ? post.mediaUrl : null}
                  media={post.media ? { contentUrl: post.media.contentUrl, mimeType: post.media.mimeType } : null}
                  accessToken={session.accessToken}
                  caption={post.content}
                  likes={post.likeCount}
                  likedByMe={post.likedByMe}
                  mood={post.mood}
                  canDelete={post.canDelete}
                  onToggleLike={toggleLike}
                  onDelete={deletePost}
                  onOpenAuthor={() => void openUserProfile(post.authorAccountId as string)}
                />
              ))}
            </section>
          ) : null}

          {section === "explore" ? (
            <section className="space-y-4">
              <div className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Поиск людей и публикаций</p>
                <div className="flex gap-2">
                  <input
                    value={exploreQuery}
                    onChange={(event) => setExploreQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void runExploreSearch();
                      }
                    }}
                    placeholder="Введите @username, имя или текст публикации"
                    className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
                    style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
                  />
                  <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void runExploreSearch()}>
                    <Search className="w-4 h-4 inline mr-2" />
                    Найти
                  </button>
                </div>
              </div>

              {exploreLoading ? <InlineInfo text="Ищем результаты..." /> : null}

              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Люди</p>
                  {!exploreHasSearched ? <InlineInfo text="Введите запрос, чтобы найти пользователей." /> : null}
                  {exploreHasSearched && !exploreLoading && exploreUsers.length === 0 ? <InlineInfo text="Пользователи не найдены." /> : null}
                  {exploreUsers.map((item) => (
                    <div key={item.accountId as string} className="rounded-xl border p-3 space-y-2" style={innerCardStyle}>
                      <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                        {item.displayName || item.username || "Пользователь"}
                      </p>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>@{item.username}</p>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                        Статус дружбы: {renderFriendState(item.friendState)}
                      </p>
                      <div className="flex gap-2">
                        <button type="button" className="px-3 py-1.5 rounded-lg border text-sm" style={outlineButtonStyle} onClick={() => void createDirect(item.accountId as string)}>
                          <MessageSquare className="w-4 h-4 inline mr-2" />
                          Написать
                        </button>
                        <button type="button" className="px-3 py-1.5 rounded-lg border text-sm" style={outlineButtonStyle} onClick={() => void openUserProfile(item.accountId as string)}>
                          <User className="w-4 h-4 inline mr-2" />
                          Профиль
                        </button>
                        {item.friendState === "none" && item.canSendFriendRequest ? (
                          <button type="button" className="px-3 py-1.5 rounded-lg border text-sm" style={outlineButtonStyle} onClick={() => void sendFriendRequest(item.accountId as string)}>
                            Добавить
                          </button>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Публикации</p>
                  {!exploreHasSearched ? <InlineInfo text="Введите запрос для публикаций." /> : null}
                  {exploreHasSearched && !exploreLoading && explorePosts.length === 0 ? <InlineInfo text="Публикации не найдены." /> : null}
                  {explorePosts.map((post) => (
                    <PostCard
                      key={post.id as string}
                      id={post.id as string}
                      authorDisplayName={post.authorDisplayName || post.authorUsername || post.authorEmail}
                      authorUsername={post.authorUsername}
                      timestamp={new Date(post.createdAt as string).toLocaleString("ru-RU")}
                      imageUrl={post.mediaType === "image" ? post.mediaUrl : null}
                      videoUrl={post.mediaType === "video" ? post.mediaUrl : null}
                      media={post.media ? { contentUrl: post.media.contentUrl, mimeType: post.media.mimeType } : null}
                      accessToken={session.accessToken}
                      caption={post.content}
                      likes={post.likeCount}
                      likedByMe={post.likedByMe}
                      mood={post.mood}
                      canDelete={post.canDelete}
                      onToggleLike={toggleLike}
                      onDelete={deletePost}
                      onOpenAuthor={() => void openUserProfile(post.authorAccountId as string)}
                    />
                  ))}
                </div>
              </div>
            </section>
          ) : null}

          {section === "notifications" ? (
            <section className="space-y-3">
              {notifications.length === 0 ? <InlineInfo text="Пока нет уведомлений." /> : notifications.map((item) => (
                <div key={`${item.id}_${item.createdAt as string}`} className="rounded-xl border p-3" style={cardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {renderNotificationTitle(item)}
                  </p>
                  {item.preview ? <p style={{ color: "var(--base-grey-light)", marginTop: 6 }}>{item.preview}</p> : null}
                  <p style={{ color: "var(--base-grey-light)", marginTop: 6, fontSize: 12 }}>
                    {new Date(item.createdAt as string).toLocaleString("ru-RU")}
                  </p>
                </div>
              ))}
            </section>
          ) : null}

          {section === "profile" ? (
            <section className="space-y-4">
              <div className="rounded-2xl border overflow-hidden" style={cardStyle}>
                <div className="h-36 border-b relative overflow-hidden" style={{ borderColor: "var(--glass-border)" }}>
                  {viewedProfile?.bannerMediaId ? (
                    <AuthenticatedImage
                      mediaId={viewedProfile.bannerMediaId as string}
                      accessToken={session.accessToken}
                      apiBaseUrl={server.config.apiBaseUrl}
                      apiPrefix={server.config.apiPrefix}
                      alt="Обложка профиля"
                      className="absolute inset-0 w-full h-full object-cover"
                      fallbackClassName="absolute inset-0 w-full h-full"
                    />
                  ) : (
                    <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#2b2f3f,#1a1f29)" }} />
                  )}
                  <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(0,0,0,0.18), rgba(0,0,0,0.45))" }} />
                </div>
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-3">
                      <div className="w-16 h-16 rounded-full border overflow-hidden shrink-0" style={{ borderColor: "var(--glass-border)", backgroundColor: "rgba(8,8,8,0.45)" }}>
                        {viewedProfile?.avatarMediaId ? (
                          <AuthenticatedImage
                            mediaId={viewedProfile.avatarMediaId as string}
                            accessToken={session.accessToken}
                            apiBaseUrl={server.config.apiBaseUrl}
                            apiPrefix={server.config.apiPrefix}
                            alt="Аватар профиля"
                            className="w-full h-full object-cover"
                            fallbackClassName="w-full h-full"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                            AV
                          </div>
                        )}
                      </div>
                      <div>
                      <p style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 700 }}>
                        {viewedProfile?.displayName || "Профиль"}
                      </p>
                      <p style={{ color: "var(--base-grey-light)" }}>
                        @{viewedProfile?.username || "username"}
                      </p>
                      {viewedProfile?.statusText ? (
                        <p style={{ color: "var(--base-grey-light)", marginTop: 8 }}>
                          {viewedProfile.statusText}
                        </p>
                      ) : null}
                    </div>
                    </div>
                    <div className="flex gap-2 flex-wrap justify-end">
                      {profileTarget ? (
                        <>
                          <button
                            type="button"
                            className="px-3 py-1.5 rounded-lg border text-sm"
                            style={outlineButtonStyle}
                            onClick={clearProfileTarget}
                          >
                            Мой профиль
                          </button>
                          {profileTarget.existingDirectConversationId ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-sm"
                              style={outlineButtonStyle}
                              onClick={() => void openConversation(profileTarget.existingDirectConversationId as string)}
                            >
                              Открыть чат
                            </button>
                          ) : profileTarget.canStartDirectChat ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-sm"
                              style={outlineButtonStyle}
                              onClick={() => void createDirect(profileTarget.accountId as string)}
                            >
                              <MessageSquare className="w-4 h-4 inline mr-2" />
                              Написать
                            </button>
                          ) : null}
                          {profileTarget.friendState === "none" && profileTarget.canSendFriendRequest ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-sm"
                              style={outlineButtonStyle}
                              onClick={() => void sendFriendRequest(profileTarget.accountId as string)}
                            >
                              Добавить в друзья
                            </button>
                          ) : null}
                          {profileTarget.friendState === "incoming_request" ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-sm"
                              style={outlineButtonStyle}
                              onClick={() => {
                                const req = incomingRequests.find((item) => (item.actor.accountId as string) === (profileTarget.accountId as string));
                                if (req) {
                                  void processFriendRequest(req.id as string, "accept", profileTarget.accountId as string);
                                }
                              }}
                            >
                              Принять заявку
                            </button>
                          ) : null}
                          {profileTarget.friendState === "outgoing_request" ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-sm"
                              style={outlineButtonStyle}
                              onClick={() => {
                                const req = outgoingRequests.find((item) => (item.target.accountId as string) === (profileTarget.accountId as string));
                                if (req) {
                                  void processFriendRequest(req.id as string, "cancel", profileTarget.accountId as string);
                                }
                              }}
                            >
                              Отменить заявку
                            </button>
                          ) : null}
                          {profileTarget.friendState === "friends" ? (
                            <button
                              type="button"
                              className="px-3 py-1.5 rounded-lg border text-sm"
                              style={outlineButtonStyle}
                              onClick={() => void removeFriend(profileTarget.accountId as string)}
                            >
                              Удалить из друзей
                            </button>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  </div>

                  {viewedProfile?.bio ? (
                    <p style={{ color: "var(--text-primary)" }}>{viewedProfile.bio}</p>
                  ) : (
                    <p style={{ color: "var(--base-grey-light)" }}>
                      {viewedProfile ? "Пока нет описания профиля." : "Профиль загружается..."}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-3 text-sm">
                    <span style={{ color: "var(--base-grey-light)" }}>Публикации: {viewedProfile?.postCount ?? 0}</span>
                    <span style={{ color: "var(--base-grey-light)" }}>Фото: {viewedProfile?.photoCount ?? 0}</span>
                    <span style={{ color: "var(--base-grey-light)" }}>Друзья: {viewedProfile?.friendCount ?? 0}</span>
                  </div>
                </div>
              </div>

              {!profileTarget ? (
                <>
                  <div className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                    <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Редактирование профиля</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <input value={profileEdit.displayName} onChange={(event) => setProfileEdit((prev) => ({ ...prev, displayName: event.target.value }))} placeholder="Отображаемое имя" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <input value={profileEdit.username} onChange={(event) => setProfileEdit((prev) => ({ ...prev, username: event.target.value }))} placeholder="@username" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <input value={profileEdit.statusText} onChange={(event) => setProfileEdit((prev) => ({ ...prev, statusText: event.target.value }))} placeholder="Статус" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <input value={profileEdit.location} onChange={(event) => setProfileEdit((prev) => ({ ...prev, location: event.target.value }))} placeholder="Локация" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <input value={profileEdit.websiteUrl} onChange={(event) => setProfileEdit((prev) => ({ ...prev, websiteUrl: event.target.value }))} placeholder="Сайт" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                    </div>
                    <textarea value={profileEdit.bio} onChange={(event) => setProfileEdit((prev) => ({ ...prev, bio: event.target.value }))} placeholder="О себе" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none resize-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)", minHeight: 90 }} />
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void saveProfile()}>
                        Сохранить профиль
                      </button>
                      <label className="px-3 py-2 rounded-lg border cursor-pointer" style={outlineButtonStyle}>
                        Загрузить аватар
                        <input type="file" className="hidden" accept="image/*" onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadProfileMedia(file, "avatar");
                          event.currentTarget.value = "";
                        }} />
                      </label>
                      <label className="px-3 py-2 rounded-lg border cursor-pointer" style={outlineButtonStyle}>
                        Загрузить обложку
                        <input type="file" className="hidden" accept="image/*" onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadProfileMedia(file, "banner");
                          event.currentTarget.value = "";
                        }} />
                      </label>
                    </div>
                  </div>

                  <div className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                    <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Истории</p>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input value={storyCaption} onChange={(event) => setStoryCaption(event.target.value)} placeholder="Подпись к истории" className="flex-1 min-w-[220px] rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <label className="px-3 py-2 rounded-lg border cursor-pointer" style={outlineButtonStyle}>
                        Добавить историю
                        <input type="file" className="hidden" accept="image/*,video/*" onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void createStory(file);
                          event.currentTarget.value = "";
                        }} />
                      </label>
                    </div>
                    {stories.length === 0 ? <InlineInfo text="Историй пока нет." /> : (
                      <div className="space-y-2">
                        {stories.slice(0, 8).map((story) => (
                          <div key={story.id as string} className="rounded-lg border px-3 py-2" style={innerCardStyle}>
                            <p style={{ color: "var(--text-primary)" }}>{story.ownerName || story.ownerUsername}</p>
                            <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                              До {new Date(story.expiresAt as string).toLocaleString("ru-RU")}
                            </p>
                            {story.caption ? <p style={{ color: "var(--base-grey-light)", marginTop: 6 }}>{story.caption}</p> : null}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                    <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Друзья и заявки</p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <p style={{ color: "var(--base-grey-light)", fontSize: 12, marginBottom: 8 }}>Друзья</p>
                        <div className="space-y-2">
                          {friends.length === 0 ? <InlineInfo text="Список друзей пуст." /> : friends.map((friend) => (
                            <div key={friend.accountId as string} className="rounded-lg border p-2" style={innerCardStyle}>
                              <p style={{ color: "var(--text-primary)" }}>{friend.displayName || friend.username}</p>
                              <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>@{friend.username}</p>
                              <div className="mt-2 flex gap-2">
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void createDirect(friend.accountId as string)}>Написать</button>
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void openUserProfile(friend.accountId as string)}>Профиль</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p style={{ color: "var(--base-grey-light)", fontSize: 12, marginBottom: 8 }}>Входящие</p>
                        <div className="space-y-2">
                          {incomingRequests.length === 0 ? <InlineInfo text="Нет входящих заявок." /> : incomingRequests.map((request) => (
                            <div key={request.id as string} className="rounded-lg border p-2" style={innerCardStyle}>
                              <p style={{ color: "var(--text-primary)" }}>{request.actor.displayName || request.actor.username}</p>
                              <div className="mt-2 flex gap-2">
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void processFriendRequest(request.id as string, "accept")}>Принять</button>
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void processFriendRequest(request.id as string, "reject")}>Отклонить</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p style={{ color: "var(--base-grey-light)", fontSize: 12, marginBottom: 8 }}>Исходящие</p>
                        <div className="space-y-2">
                          {outgoingRequests.length === 0 ? <InlineInfo text="Нет исходящих заявок." /> : outgoingRequests.map((request) => (
                            <div key={request.id as string} className="rounded-lg border p-2" style={innerCardStyle}>
                              <p style={{ color: "var(--text-primary)" }}>{request.target.displayName || request.target.username}</p>
                              <div className="mt-2 flex gap-2">
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void processFriendRequest(request.id as string, "cancel")}>Отменить</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              ) : null}

              {(!profileTarget || profileTarget.canViewPosts) ? (
                <div className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                    {profileTarget ? "Публикации пользователя" : "Мои публикации"}
                  </p>
                  {profileLoading ? <InlineInfo text="Загрузка публикаций..." /> : null}
                  {!profileLoading && profilePosts.length === 0 ? <InlineInfo text="Публикаций пока нет." /> : null}
                  {profilePosts.map((post) => (
                    <PostCard
                      key={post.id as string}
                      id={post.id as string}
                      authorDisplayName={post.authorDisplayName || post.authorUsername || post.authorEmail}
                      authorUsername={post.authorUsername}
                      timestamp={new Date(post.createdAt as string).toLocaleString("ru-RU")}
                      imageUrl={post.mediaType === "image" ? post.mediaUrl : null}
                      videoUrl={post.mediaType === "video" ? post.mediaUrl : null}
                      media={post.media ? { contentUrl: post.media.contentUrl, mimeType: post.media.mimeType } : null}
                      accessToken={session.accessToken}
                      caption={post.content}
                      likes={post.likeCount}
                      likedByMe={post.likedByMe}
                      mood={post.mood}
                      canDelete={post.canDelete}
                      onToggleLike={toggleLike}
                      onDelete={deletePost}
                      onOpenAuthor={() => void openUserProfile(post.authorAccountId as string)}
                    />
                  ))}
                </div>
              ) : (
                <InlineInfo text="Публикации этого профиля скрыты настройками приватности." />
              )}
            </section>
          ) : null}

          {section === "settings" ? (
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
                ] as Array<[SettingsSection, string]>).map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="px-3 py-1.5 rounded-lg border text-sm"
                    style={settingsSection === value ? solidButtonStyle : outlineButtonStyle}
                    onClick={() => setSettingsSection(value)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {settingsMessage ? <InlineInfo text={settingsMessage} /> : null}

              {settingsSection === "account" ? (
                <div className="rounded-xl border p-3 space-y-3" style={innerCardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Аккаунт</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Email: {session.email}</p>
                  <p style={{ color: "var(--base-grey-light)" }}>
                    Режим сессии: {sessionMode === "remembered" ? "Запомнить" : "Только вкладка"}
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="px-4 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void logout(false)}>Выйти</button>
                    <button type="button" className="px-4 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void logout(true)}>Выйти везде</button>
                  </div>
                </div>
              ) : null}

              {settingsSection === "sessions" ? (
                <div className="rounded-xl border p-3 space-y-2" style={innerCardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Текущая сессия</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Платформа: {sessionInfo?.session.clientPlatform ?? "web-browser"}</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Класс: {sessionInfo?.session.sessionClass ?? "browser"}</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Постоянная: {sessionInfo?.session.persistent ? "Да" : "Нет"}</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Создана: {sessionInfo?.session.createdAt ? new Date(sessionInfo.session.createdAt as string).toLocaleString("ru-RU") : "-"}</p>
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
                          <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>{device.platform} · {device.status}</p>
                        </div>
                        {!isCurrent ? (
                          <button type="button" className="px-3 py-1.5 rounded-lg border text-sm" style={outlineButtonStyle} onClick={() => void revokeDevice(id)}>
                            Отозвать
                          </button>
                        ) : (
                          <span className="text-xs px-2 py-1 rounded" style={{ backgroundColor: "var(--accent-brown)", color: "var(--core-background)" }}>Текущее</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : null}

              {settingsSection === "security" ? (
                <div className="rounded-xl border p-3 space-y-3" style={innerCardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Двухфакторная защита и события</p>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void startTwoFactorSetup()}>
                      <Shield className="w-4 h-4 inline mr-2" />
                      Начать настройку 2FA
                    </button>
                  </div>
                  {twoFASetup ? (
                    <div className="space-y-2 rounded-lg border p-3" style={innerCardStyle}>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12, wordBreak: "break-all" }}>Секрет: {twoFASetup.secret}</p>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12, wordBreak: "break-all" }}>URI: {twoFASetup.provisioningUri}</p>
                      <input value={twoFAEnableCode} onChange={(event) => setTwoFAEnableCode(event.target.value)} placeholder="Код из приложения" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void confirmTwoFactorSetup()}>
                        Подтвердить 2FA
                      </button>
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <input value={twoFADisableCode} onChange={(event) => setTwoFADisableCode(event.target.value)} placeholder="Код для отключения 2FA" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                    <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void disableTwoFactor()}>
                      Отключить 2FA
                    </button>
                  </div>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>События безопасности</p>
                  {securityEvents.slice(0, 10).map((event) => (
                    <div key={event.id as string} className="rounded-lg border px-3 py-2" style={innerCardStyle}>
                      <p style={{ color: "var(--text-primary)" }}>{event.eventType}</p>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>{new Date(event.createdAt as string).toLocaleString("ru-RU")}</p>
                    </div>
                  ))}
                </div>
              ) : null}

              {settingsSection === "privacy" ? (
                <div className="rounded-xl border p-3 space-y-3" style={innerCardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Приватность профиля</p>
                  {!privacy ? <InlineInfo text="Настройки приватности загружаются..." /> : (
                    <>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                        Профиль: {renderVisibilityScope(privacy.profileVisibility)} · Публикации: {renderVisibilityScope(privacy.postsVisibility)} · Фото: {renderVisibilityScope(privacy.photosVisibility)}
                      </p>
                      <div className="grid gap-2 md:grid-cols-2">
                        <select value={privacy.postsVisibility} onChange={(event) => setPrivacy((prev) => (prev ? { ...prev, postsVisibility: event.target.value as never } : prev))} className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}>
                          <option value="public">Публикации: всем</option>
                          <option value="friends">Публикации: друзьям</option>
                          <option value="only_me">Публикации: только мне</option>
                        </select>
                        <select value={privacy.dmPolicy} onChange={(event) => setPrivacy((prev) => (prev ? { ...prev, dmPolicy: event.target.value as never } : prev))} className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}>
                          <option value="friends">ЛС: только друзья</option>
                          <option value="everyone">ЛС: все</option>
                          <option value="nobody">ЛС: никто</option>
                        </select>
                        <select value={privacy.friendRequestsPolicy} onChange={(event) => setPrivacy((prev) => (prev ? { ...prev, friendRequestsPolicy: event.target.value as never } : prev))} className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}>
                          <option value="anyone">Заявки: от всех</option>
                          <option value="friends_of_friends">Заявки: друзья друзей</option>
                          <option value="nobody">Заявки: никто</option>
                        </select>
                      </div>
                      <button
                        type="button"
                        className="px-3 py-2 rounded-lg border"
                        style={outlineButtonStyle}
                        onClick={async () => {
                          if (!api || !session || !privacy) return;
                          try {
                            const updated = await api.updatePrivacy(session.accessToken, {
                              postsVisibility: privacy.postsVisibility,
                              dmPolicy: privacy.dmPolicy,
                              friendRequestsPolicy: privacy.friendRequestsPolicy,
                            });
                            setPrivacy(updated.privacy);
                            setSettingsMessage("Настройки приватности сохранены.");
                          } catch (error) {
                            setSettingsMessage(toUserError(error));
                          }
                        }}
                      >
                        Сохранить приватность
                      </button>
                    </>
                  )}
                </div>
              ) : null}

              {settingsSection === "app" ? (
                <div className="rounded-xl border p-3 space-y-2" style={innerCardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Приложение</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Тема: Тёмная</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Язык: Русский</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Уведомления: включены</p>
                </div>
              ) : null}

              {settingsSection === "connection" ? (
                <div className="rounded-xl border p-3 space-y-3" style={innerCardStyle}>
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Сервер и подключение</p>
                  <p style={{ color: "var(--base-grey-light)" }}>Текущий сервер: {server.input}</p>
                  <div className="flex gap-2 flex-wrap">
                    <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void testConnection()}>
                      Проверить соединение
                    </button>
                    <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void resetServer()}>
                      Сменить сервер
                    </button>
                  </div>
                </div>
              ) : null}
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

function AutoConnectScreen({ onRetry, error }: { onRetry: () => Promise<void>; error: string }) {
  return (
    <StandaloneCard title="Подключение к серверу" subtitle="Пытаемся подключиться автоматически к текущему домену сайта.">
      {error ? <InlineInfo tone="error" text={error} /> : null}
      <button type="button" className="w-full rounded-lg border px-4 py-2" style={outlineButtonStyle} onClick={() => void onRetry()}>
        Повторить подключение
      </button>
    </StandaloneCard>
  );
}

function AuthScreen(props: {
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
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Код 2FA" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
          <button type="button" className="w-full rounded-lg border px-4 py-2" style={outlineButtonStyle} onClick={() => void props.onVerify(code)}>Подтвердить</button>
        </>
      ) : (
        <>
          <div className="flex gap-2">
            <button type="button" className="px-3 py-1.5 rounded-lg border" style={authMode === "login" ? solidButtonStyle : outlineButtonStyle} onClick={() => setAuthMode("login")}>Вход</button>
            <button type="button" className="px-3 py-1.5 rounded-lg border" style={authMode === "register" ? solidButtonStyle : outlineButtonStyle} onClick={() => setAuthMode("register")}>Регистрация</button>
          </div>
          <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Пароль" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
          <select value={props.mode} onChange={(e) => void props.onModeChange(e.target.value as SessionMode)} className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}><option value="ephemeral">Только текущая вкладка</option><option value="remembered">Запомнить на устройстве</option></select>
          <button type="button" className="w-full rounded-lg border px-4 py-2" style={outlineButtonStyle} onClick={() => void props.onSubmit(authMode, email, password)}>{authMode === "login" ? "Войти" : "Создать аккаунт"}</button>
        </>
      )}
      <button type="button" className="text-sm underline" style={{ color: "var(--base-grey-light)" }} onClick={() => void props.onChangeServer()}>Сменить сервер</button>
      {props.error ? <InlineInfo tone="error" text={props.error} /> : null}
    </StandaloneCard>
  );
}

function StandaloneCard({ title, subtitle, children }: { title: string; subtitle: string; children?: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4" style={{ backgroundColor: "var(--core-background)" }}>
      <div className="w-full max-w-[480px] rounded-2xl border p-6 space-y-3" style={cardStyle}><h1 style={{ color: "var(--text-primary)", fontSize: 28, fontWeight: 600 }}>{title}</h1><p style={{ color: "var(--base-grey-light)" }}>{subtitle}</p>{children}</div>
    </div>
  );
}

function AuthenticatedImage(props: {
  mediaId: string;
  accessToken: string;
  apiBaseUrl: string;
  apiPrefix: string;
  alt: string;
  className?: string;
  fallbackClassName?: string;
}) {
  const { mediaId, accessToken, apiBaseUrl, apiPrefix, alt, className, fallbackClassName } = props;
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");

  React.useEffect(() => {
    let disposed = false;
    let currentObjectUrl: string | null = null;

    const load = async () => {
      setError("");
      setBlobUrl(null);
      try {
        const endpoint = `${apiBaseUrl}${apiPrefix}/media/${encodeURIComponent(mediaId)}/content`;
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        });
        if (!response.ok) {
          throw new Error("Не удалось загрузить изображение.");
        }
        const blob = await response.blob();
        currentObjectUrl = URL.createObjectURL(blob);
        if (!disposed) {
          setBlobUrl(currentObjectUrl);
        }
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить изображение.");
        }
      }
    };

    void load();
    return () => {
      disposed = true;
      if (currentObjectUrl) {
        URL.revokeObjectURL(currentObjectUrl);
      }
    };
  }, [accessToken, apiBaseUrl, apiPrefix, mediaId]);

  if (!blobUrl) {
    return (
      <div className={fallbackClassName ?? className} style={{ background: "linear-gradient(135deg,#2b2f3f,#1a1f29)" }}>
        {error ? (
          <div className="w-full h-full flex items-center justify-center" style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
            Ошибка загрузки
          </div>
        ) : null}
      </div>
    );
  }

  return <img src={blobUrl} alt={alt} className={className} />;
}

function MessageRow({
  message,
  onResend,
  onDownloadAttachment,
  attachmentOpState,
}: {
  message: MessageView;
  onResend?: () => Promise<void>;
  onDownloadAttachment: (attachment: MessageAttachmentView) => Promise<void>;
  attachmentOpState: Record<string, { loading: boolean; error: string }>;
}) {
  return (
    <div className={`flex ${message.own ? "justify-end" : "justify-start"}`}>
      <div className="max-w-[78%] rounded-2xl border px-3 py-2 space-y-1" style={message.own ? { ...selectedCardStyle, borderColor: "var(--accent-brown)" } : innerCardStyle}>
        <p style={{ color: "var(--text-primary)", whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{linkifyText(message.text)}</p>
        {message.attachments.length > 0 ? (
          <div className="space-y-2">
            {message.attachments.map((attachment) => {
              const op = attachmentOpState[attachment.id];
              return (
                <div key={attachment.id} className="rounded-lg border px-3 py-2 space-y-2" style={innerCardStyle}>
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <p style={{ color: "var(--text-primary)" }}>{attachment.fileName}</p>
                      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                        {attachment.kind === "image" ? "Изображение" : "Файл"} · {formatBytes(attachment.sizeBytes)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="px-2 py-1 rounded-lg border text-xs"
                      style={outlineButtonStyle}
                      onClick={() => void onDownloadAttachment(attachment)}
                      disabled={op?.loading}
                    >
                      <Download className="w-4 h-4 inline mr-1" />
                      {op?.loading ? "Скачиваем..." : "Скачать"}
                    </button>
                  </div>
                  {op?.error ? <p style={{ color: "#fca5a5", fontSize: 12 }}>{op.error}</p> : null}
                </div>
              );
            })}
          </div>
        ) : null}
        <div className="flex items-center justify-between">
          <p style={{ color: "var(--base-grey-light)", fontSize: 11 }}>{message.localStatus === "sending" ? "Отправляем..." : message.localStatus === "failed" ? "Ошибка отправки" : message.deliveryState}</p>
          {message.localStatus === "failed" && onResend ? <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void onResend()}>Повторить</button> : null}
        </div>
      </div>
    </div>
  );
}

function InlineInfo({ text, tone = "default" }: { text: string; tone?: "default" | "error" | "warning" }) {
  const color = tone === "error" ? "#fca5a5" : tone === "warning" ? "#fde68a" : "var(--text-primary)";
  return <div className="rounded-xl border px-3 py-2" style={innerCardStyle}><p style={{ color }}>{text}</p></div>;
}

function StatusChip({ state }: { state: RuntimeTransportState["status"] }) {
  const descriptor = state === "connected" ? { label: "Онлайн", icon: Wifi, color: "#86efac" } : state === "degraded" ? { label: "Ограниченно", icon: AlertTriangle, color: "#fde68a" } : state === "connecting" || state === "reconnecting" ? { label: "Подключение", icon: Loader2, color: "#93c5fd" } : { label: "Офлайн", icon: WifiOff, color: "#fca5a5" };
  const Icon = descriptor.icon;
  return <span className="inline-flex items-center gap-2 rounded-lg border px-3 py-1 text-sm" style={innerCardStyle}><Icon className={`w-4 h-4 ${state === "connecting" || state === "reconnecting" ? "animate-spin" : ""}`} style={{ color: descriptor.color }} /><span style={{ color: descriptor.color }}>{descriptor.label}</span></span>;
}

function TransportCard({ state }: { state: RuntimeTransportState }) {
  return (
    <div className="rounded-xl border p-3 space-y-1" style={innerCardStyle}>
      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Режим: {state.mode}</p>
      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Статус: {state.status}</p>
      <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Курсор: {state.lastCursor}</p>
      {state.endpoint ? <p style={{ color: "var(--base-grey-light)", fontSize: 12, wordBreak: "break-all" }}>Endpoint: {state.endpoint}</p> : null}
      {state.lastError ? <p style={{ color: "#fca5a5", fontSize: 12 }}>{state.lastError}</p> : null}
    </div>
  );
}

function sectionTitle(section: SidebarSection): string {
  if (section === "messages") return "Сообщения";
  if (section === "feed") return "Лента";
  if (section === "explore") return "Обзор";
  if (section === "notifications") return "Уведомления";
  if (section === "profile") return "Профиль";
  return "Настройки";
}

function sectionSubtitle(section: SidebarSection, server: string, transportState: RuntimeTransportState): string {
  if (section === "messages") return `Сервер: ${server} · ${transportState.status}`;
  return `Сервер: ${server}`;
}

function normalizeUserSearchInput(value: string): string {
  return value.trim().replace(/^@+/, "").trim();
}

function renderVisibilityScope(value: string): string {
  if (value === "public" || value === "everyone") return "всем";
  if (value === "friends") return "друзьям";
  if (value === "only_me") return "только мне";
  return value;
}

function renderFriendState(value: string): string {
  if (value === "friends") return "друзья";
  if (value === "incoming_request") return "входящая заявка";
  if (value === "outgoing_request") return "исходящая заявка";
  if (value === "blocked") return "заблокирован";
  return "нет связи";
}

function renderNotificationTitle(item: NotificationsResponse["notifications"][number]): string {
  const actor = item.actorName || item.actorUsername || "Пользователь";
  if (item.type === "friend_request") return `${actor} отправил(а) заявку в друзья`;
  if (item.type === "friend_accepted") return `${actor} принял(а) заявку в друзья`;
  if (item.type === "story_published") return `${actor} опубликовал(а) историю`;
  if (item.type === "social_like") return `${actor} поставил(а) лайк`;
  return "Новое уведомление";
}

function resolveConversationTitle(summary: ConversationSummaryDTO | null): string {
  if (!summary) return "Чат";
  if (summary.title && summary.title.trim()) return summary.title;
  if (summary.type === "direct") return summary.directPeerEmail || summary.directPeerAccountId || "Личный чат";
  return "Группа";
}

async function decodeMessage(message: MessageDTO, session: SessionState, device: DeviceMaterial | null): Promise<MessageView> {
  const recipient = message.envelope.recipients.find((item) => (item.recipientDeviceId as string) === session.deviceId);
  let text = "Зашифрованное сообщение";
  let attachmentSecrets: AttachmentSecret[] = [];
  if (recipient && device?.privateKey) {
    try {
      const decrypted = await webCryptoProvider.decryptMessage({
        ciphertext: message.envelope.ciphertext,
        nonce: message.envelope.nonce,
        wrappedKey: recipient.wrappedKey,
        recipientPublicKey: device.publicKey,
        recipientPrivateKey: device.privateKey,
      });
      const parsed = parsePlaintextPayload(decrypted);
      text = parsed.text || "";
      attachmentSecrets = parsed.attachments;
    } catch {
      text = "Не удалось расшифровать сообщение";
    }
  }

  const attachments = mapMessageAttachments(message.envelope.attachments, attachmentSecrets);

  return {
    id: message.envelope.id as string,
    conversationId: message.envelope.conversationId as string,
    senderAccountId: message.envelope.senderAccountId as string,
    createdAt: message.envelope.createdAt as string,
    serverSequence: message.envelope.serverSequence,
    text,
    attachments,
    own: (message.envelope.senderAccountId as string) === session.accountId,
    deliveryState: message.deliveryState,
  };
}

function collectRecipients(members: ConversationDTO["members"]): RecipientPublicMaterial[] {
  const result: RecipientPublicMaterial[] = [];
  for (const member of members) {
    if (!member.isActive) continue;
    for (const device of member.trustedDevices) {
      result.push({ recipientDeviceId: device.id as string, publicKey: device.publicDeviceMaterial });
    }
  }
  return result;
}

async function applySyncBatch(
  batch: SyncBatchDTO,
  session: SessionState,
  device: DeviceMaterial | null,
  activeConversationId: string | null,
  setMessages: React.Dispatch<React.SetStateAction<Record<string, MessageBucket>>>,
  setUnread: React.Dispatch<React.SetStateAction<Record<string, number>>>,
) {
  const mapped: MessageView[] = [];
  for (const event of batch.events) {
    if (event.type === "message" && event.message) {
      mapped.push(await decodeMessage(event.message, session, device));
    }
  }

  if (mapped.length === 0) return;

  setMessages((current) => {
    const next = { ...current };
    for (const item of mapped) {
      const bucket = next[item.conversationId] ?? { loading: false, error: "", items: [] };
      const filtered = bucket.items.filter((existing) => existing.id !== item.id);
      next[item.conversationId] = {
        ...bucket,
        items: filtered.concat(item).sort((a, b) => a.serverSequence - b.serverSequence),
      };
    }
    if (activeConversationId && next[activeConversationId]) {
      next[activeConversationId].error = "";
    }
    return next;
  });

  setUnread((current) => {
    const next = { ...current };
    for (const item of mapped) {
      if (item.own) {
        continue;
      }
      if (activeConversationId && item.conversationId === activeConversationId) {
        next[item.conversationId] = 0;
        continue;
      }
      next[item.conversationId] = (next[item.conversationId] ?? 0) + 1;
    }
    return next;
  });
}

function parsePlaintextPayload(plaintext: string): { text: string; attachments: AttachmentSecret[] } {
  try {
    const parsed = JSON.parse(plaintext) as { text?: unknown; attachments?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments
          .map((item) => normalizeAttachmentSecret(item))
          .filter((item): item is AttachmentSecret => item !== null)
      : [];
    return { text, attachments };
  } catch {
    return { text: plaintext, attachments: [] };
  }
}

function normalizeAttachmentSecret(value: unknown): AttachmentSecret | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const attachmentId = String(source.attachmentId ?? "").trim();
  const fileName = String(source.fileName ?? "").trim();
  const mimeType = String(source.mimeType ?? "").trim();
  const nonce = String(source.nonce ?? "").trim();
  const symmetricKey = String(source.symmetricKey ?? "").trim();
  const checksumSha256 = String(source.checksumSha256 ?? "").trim();
  const algorithm = String(source.algorithm ?? "xchacha20poly1305_ietf").trim();
  const sizeBytesRaw = Number(source.sizeBytes ?? 0);
  if (!attachmentId || !fileName || !mimeType || !nonce || !symmetricKey) {
    return null;
  }
  return {
    attachmentId,
    fileName,
    mimeType,
    sizeBytes: Number.isFinite(sizeBytesRaw) ? Math.max(0, Math.floor(sizeBytesRaw)) : 0,
    symmetricKey,
    nonce,
    checksumSha256,
    algorithm,
  };
}

function mapMessageAttachments(
  attachments: AttachmentMetaDTO[] | undefined,
  secrets: AttachmentSecret[],
): MessageAttachmentView[] {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  const secretByID = new Map(secrets.map((item) => [item.attachmentId, item]));
  return attachments.map((attachment) => {
    const id = attachment.id as string;
    const secret = secretByID.get(id);
    return {
      id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      checksumSha256: attachment.checksumSha256,
      algorithm: attachment.encryption.algorithm,
      nonce: secret?.nonce ?? attachment.encryption.nonce,
      symmetricKey: secret?.symmetricKey ?? null,
    };
  });
}

async function uploadEncryptedAttachments(
  api: WebApiClient,
  accessToken: string,
  uploads: UploadDraft[],
): Promise<AttachmentSecret[]> {
  const result: AttachmentSecret[] = [];
  for (const item of uploads) {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const encrypted = await webCryptoProvider.encryptAttachment(bytes);
    const ciphertextBytes = base64ToBytes(encrypted.ciphertext);
    const payload: AttachmentUploadRequest = {
      kind: item.file.type.startsWith("image/") ? "image" : "file",
      fileName: item.file.name,
      mimeType: item.file.type || "application/octet-stream",
      sizeBytes: ciphertextBytes.byteLength,
      checksumSha256: encrypted.checksumSha256,
      algorithm: encrypted.algorithm,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    };
    const response = await api.uploadAttachment(accessToken, payload);
    result.push({
      attachmentId: response.attachment.id as string,
      fileName: response.attachment.fileName,
      mimeType: response.attachment.mimeType,
      sizeBytes: response.attachment.sizeBytes,
      symmetricKey: encrypted.symmetricKey,
      nonce: encrypted.nonce,
      checksumSha256: encrypted.checksumSha256,
      algorithm: encrypted.algorithm,
    });
  }
  return result;
}

async function loadProfilePosts(
  api: WebApiClient,
  session: SessionState,
  setPosts: React.Dispatch<React.SetStateAction<CreateSocialPostResponse["post"][]>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  accountId?: string,
) {
  setLoading(true);
  try {
    if (accountId && accountId !== session.accountId) {
      const response = await api.listPosts(session.accessToken, { limit: 80, mediaType: "all" });
      setPosts(response.posts.filter((item) => (item.authorAccountId as string) === accountId));
    } else {
      const response = await api.listPosts(session.accessToken, { scope: "mine", limit: 30 });
      setPosts(response.posts);
    }
  } catch {
    setPosts([]);
  } finally {
    setLoading(false);
  }
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 Б";
  if (value < 1024) return `${value} Б`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} КБ`;
  return `${(value / (1024 * 1024)).toFixed(1)} МБ`;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

function linkifyText(text: string): React.ReactNode {
  const normalized = text || "";
  const regex = /(https?:\/\/[^\s]+)/gi;
  const parts = normalized.split(regex);
  if (parts.length === 1) {
    return normalized;
  }
  return parts.map((part, index) => {
    if (!/^https?:\/\/[^\s]+$/i.test(part)) {
      return <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>;
    }
    return (
      <a
        key={`${part}-${index}`}
        href={part}
        target="_blank"
        rel="noreferrer noopener"
        style={{ color: "var(--accent-brown)", textDecoration: "underline" }}
      >
        {part}
      </a>
    );
  });
}

async function loadSummaries(
  api: WebApiClient,
  session: SessionState,
  setSummaries: React.Dispatch<React.SetStateAction<ConversationSummaryDTO[]>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
  setActiveConversation: React.Dispatch<React.SetStateAction<string | null>>,
) {
  setLoading(true);
  setError("");
  try {
    const response = await api.listConversationSummaries(session.accessToken, { limit: 100, offset: 0 });
    setSummaries(response.summaries);
    if (response.summaries.length > 0) {
      setActiveConversation((current) => current ?? (response.summaries[0].id as string));
    }
  } catch (error) {
    setSummaries([]);
    setError(toUserError(error));
  } finally {
    setLoading(false);
  }
}

async function loadFeed(
  api: WebApiClient,
  session: SessionState,
  setPosts: React.Dispatch<React.SetStateAction<CreateSocialPostResponse["post"][]>>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setError: React.Dispatch<React.SetStateAction<string>>,
) {
  setLoading(true);
  setError("");
  try {
    const response = await api.listPosts(session.accessToken, { limit: 30, mediaType: "all" });
    setPosts(response.posts);
  } catch (error) {
    setPosts([]);
    setError(toUserError(error));
  } finally {
    setLoading(false);
  }
}

async function loadNotifications(
  api: WebApiClient,
  session: SessionState,
  setNotifications: React.Dispatch<React.SetStateAction<NotificationsResponse["notifications"]>>,
) {
  const response = await api.listNotifications(session.accessToken, 50).catch(() => ({ notifications: [], total: 0 }));
  setNotifications(response.notifications);
}

async function loadProfileState(
  api: WebApiClient,
  session: SessionState,
  setMyProfile: React.Dispatch<React.SetStateAction<ProfileDTO | null>>,
  setProfileEdit: React.Dispatch<
    React.SetStateAction<{
      displayName: string;
      username: string;
      bio: string;
      statusText: string;
      location: string;
      websiteUrl: string;
    }>
  >,
  setFriends: React.Dispatch<React.SetStateAction<FriendListItemDTO[]>>,
  setIncomingRequests: React.Dispatch<React.SetStateAction<FriendRequestDTO[]>>,
  setOutgoingRequests: React.Dispatch<React.SetStateAction<FriendRequestDTO[]>>,
  setPrivacy: React.Dispatch<React.SetStateAction<PrivacyResponse["privacy"] | null>>,
  setStories: React.Dispatch<React.SetStateAction<StoryDTO[]>>,
) {
  const [profile, friends, incoming, outgoing, privacy, stories] = await Promise.all([
    api.getMyProfile(session.accessToken).catch(() => null),
    api.listFriends(session.accessToken, 200).catch(() => ({ friends: [] })),
    api.listFriendRequests(session.accessToken, "incoming", 200).catch(() => ({ requests: [] })),
    api.listFriendRequests(session.accessToken, "outgoing", 200).catch(() => ({ requests: [] })),
    api.getPrivacy(session.accessToken).catch(() => null),
    api.listStoryFeed(session.accessToken, 60).catch(() => ({ stories: [] })),
  ]);

  setMyProfile(profile?.profile ?? null);
  setProfileEdit({
    displayName: profile?.profile.displayName ?? "",
    username: profile?.profile.username ?? "",
    bio: profile?.profile.bio ?? "",
    statusText: profile?.profile.statusText ?? "",
    location: profile?.profile.location ?? "",
    websiteUrl: profile?.profile.websiteUrl ?? "",
  });
  setFriends(friends.friends ?? []);
  setIncomingRequests(incoming.requests ?? []);
  setOutgoingRequests(outgoing.requests ?? []);
  setPrivacy(privacy?.privacy ?? null);
  setStories(stories.stories ?? []);
}

async function loadSettingsData(
  api: WebApiClient,
  session: SessionState,
  setSessionInfo: React.Dispatch<React.SetStateAction<AuthSessionResponse | null>>,
  setDeviceList: React.Dispatch<React.SetStateAction<DeviceListResponse | null>>,
  setSecurityEvents: React.Dispatch<React.SetStateAction<SecurityEventsResponse["events"]>>,
) {
  const [sessionInfo, deviceList, security] = await Promise.all([
    api.webSession(session.accessToken).catch(() => null),
    api.listDevices(session.accessToken).catch(() => null),
    api.listSecurityEvents(session.accessToken, 20).catch(() => ({ events: [] })),
  ]);
  setSessionInfo(sessionInfo);
  setDeviceList(deviceList);
  setSecurityEvents(security.events);
}

async function fetchServerConfig(origin: string): Promise<ServerBootstrapConfig> {
  const endpoint = buildServerConfigEndpoint(origin);
  const controller = new AbortController();
  const timeoutHandle = window.setTimeout(() => controller.abort(), serverConfigFetchTimeoutMs);
  let response: Response;
  try {
    response = await fetch(endpoint, { method: "GET", signal: controller.signal });
  } catch {
    throw new Error("Не удалось подключиться к серверу.");
  } finally {
    window.clearTimeout(timeoutHandle);
  }
  if (response.status === 404) return buildFallbackConfig(origin);
  if (!response.ok) throw new Error("Сервер вернул некорректный ответ конфигурации.");
  const payload = await response.json().catch(() => null);
  return parseServerConfigPayload(payload);
}

function detectDefaultServerInput(): string {
  if (typeof window === "undefined") {
    return "http://localhost:8080";
  }
  if (!window.location.origin || window.location.origin === "null") {
    return "http://localhost:8080";
  }
  return window.location.origin;
}

function loadSavedServer(): SavedServer | null {
  try {
    const raw = localStorage.getItem(serverStorageKey);
    if (!raw) return null;
    return JSON.parse(raw) as SavedServer;
  } catch {
    return null;
  }
}

async function restoreSession(config: ServerBootstrapConfig, mode: SessionMode): Promise<SessionState | null> {
  let refreshToken = await secretVault.get(refreshTokenStorageKey);
  if (!refreshToken && mode === "remembered") refreshToken = await safeStoreGet(refreshTokenStorageKey);
  if (!refreshToken) return null;

  const api = new WebApiClient(config);
  try {
    const refreshed = await api.refreshWeb(refreshToken);
    const profile = await api.webSession(refreshed.tokens.accessToken);
    await secretVault.set(refreshTokenStorageKey, refreshed.tokens.refreshToken);
    if (mode === "remembered") await safeStoreSet(refreshTokenStorageKey, refreshed.tokens.refreshToken);
    return {
      accessToken: refreshed.tokens.accessToken,
      refreshToken: refreshed.tokens.refreshToken,
      accountId: refreshed.accountId as string,
      email: profile.email,
      deviceId: refreshed.device.id as string,
    };
  } catch {
    await clearAuthState();
    return null;
  }
}

async function clearAuthState() {
  await secretVault.delete(refreshTokenStorageKey);
  await safeStoreDelete(refreshTokenStorageKey);
  await safeStoreDelete(syncCursorStorageKey);
}

function browserDeviceName(): string {
  if (typeof navigator === "undefined") return "Web Browser";
  const userAgent = navigator.userAgent.toLowerCase();
  if (userAgent.includes("firefox")) return "Firefox Browser";
  if (userAgent.includes("edg")) return "Edge Browser";
  if (userAgent.includes("chrome")) return "Chrome Browser";
  if (userAgent.includes("safari")) return "Safari Browser";
  return "Web Browser";
}

function normalizeSessionMode(value: string | null): SessionMode | null {
  if (value === "ephemeral" || value === "remembered") return value;
  return null;
}

async function safeStoreGet(key: string): Promise<string | null> {
  try {
    return await withTimeout(persistentStore.get(key), safeStoreTimeoutMs, null);
  } catch {
    return null;
  }
}

async function safeStoreSet(key: string, value: string): Promise<void> {
  try {
    await withTimeout(
      persistentStore
        .set(key, value)
        .then(() => undefined)
        .catch(() => undefined),
      safeStoreTimeoutMs,
      undefined,
    );
  } catch {
    // noop
  }
}

async function safeStoreDelete(key: string): Promise<void> {
  try {
    await withTimeout(
      persistentStore
        .delete(key)
        .then(() => undefined)
        .catch(() => undefined),
      safeStoreTimeoutMs,
      undefined,
    );
  } catch {
    // noop
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((resolve) => {
        handle = setTimeout(() => resolve(fallback), Math.max(250, timeoutMs));
      }),
    ]);
  } finally {
    if (handle) clearTimeout(handle);
  }
}

function toUserError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "invalid_credentials") return "Неверный email или пароль.";
    if (error.code === "two_fa_required") return "Нужен код двухфакторной аутентификации.";
    if (error.code === "account_already_exists") return "Аккаунт уже существует.";
    if (error.code === "fingerprint_mismatch") return "Конфликт ключа устройства. Очистите данные сайта и войдите снова.";
    if (error.code === "device_not_approved") return "Устройство не подтверждено. Завершите подтверждение входа.";
    if (error.code === "network_error") return "Не удалось подключиться к серверу.";
    return error.message || "Ошибка запроса.";
  }
  if (error instanceof Error) return error.message || "Произошла ошибка.";
  return "Произошла ошибка.";
}

const cardStyle: React.CSSProperties = {
  backgroundColor: "var(--glass-fill-base)",
  borderColor: "var(--glass-border)",
  backdropFilter: "blur(20px)",
};

const innerCardStyle: React.CSSProperties = {
  backgroundColor: "rgba(20, 20, 20, 0.52)",
  borderColor: "var(--glass-border)",
};

const selectedCardStyle: React.CSSProperties = {
  backgroundColor: "rgba(60, 70, 92, 0.42)",
  borderColor: "var(--accent-brown)",
};

const outlineButtonStyle: React.CSSProperties = {
  borderColor: "var(--accent-brown)",
  color: "var(--accent-brown)",
};

const solidButtonStyle: React.CSSProperties = {
  borderColor: "var(--accent-brown)",
  backgroundColor: "var(--accent-brown)",
  color: "var(--core-background)",
};

export default App;

