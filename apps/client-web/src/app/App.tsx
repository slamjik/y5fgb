import type {
  AuthSessionResponse,
  ConversationDTO,
  ConversationSummaryDTO,
  CreateGroupConversationRequest,
  CreateSocialPostRequest,
  CreateSocialPostResponse,
  DeviceListResponse,
  LoginSuccessResponse,
  LoginTwoFactorRequiredResponse,
  FriendListItemDTO,
  FriendRequestDTO,
  NotificationsResponse,
  PrivacyResponse,
  ProfileDTO,
  SecurityEventsResponse,
  StoryDTO,
  TwoFactorSetupStartResponse,
  UserSearchResponse,
} from "@project/protocol";
import {
  buildServerConfigEndpoint,
  normalizeServerInput,
} from "@project/client-core";
import {
  MessageSquare,
} from "lucide-react";
import React from "react";

import { webCryptoProvider } from "../features/messaging/crypto";
import { WebMessagingRuntime, type RuntimeTransportState } from "../features/messaging/runtime";
import { ApiClientError, WebApiClient, type WebDevicePayload } from "../shared/api/client";
import { AuthenticatedImage } from "./components/AuthenticatedImage";
import type { CreatePostPayload } from "./components/CreatePost";
import { ExploreSearchPanel } from "./components/ExploreSearchPanel";
import { ProfileHeader } from "./components/ProfileHeader";
import { ProfilePostsSection } from "./components/ProfilePostsSection";
import { ProfileStats } from "./components/ProfileStats";
import { Sidebar, type SidebarSection } from "./components/Sidebar";
import { AutoConnectScreen, AuthScreen, StandaloneCard } from "./components/StandaloneScreens";
import { StoryFeed } from "./components/StoryFeed";
import { InlineInfo, StatusChip, UploadStatusPill } from "./components/common/StatusInfo";
import { FeedSection } from "./components/sections/FeedSection";
import { MessagesSection } from "./components/sections/MessagesSection";
import { NotificationsSection } from "./components/sections/NotificationsSection";
import { SettingsSection as SettingsPanel } from "./components/sections/SettingsSection";
import { cardStyle, innerCardStyle, outlineButtonStyle } from "./styles";
import {
  browserDeviceName,
  clearAuthState,
  clearPersistedDeviceMaterial,
  detectDefaultServerInput,
  fetchServerConfig,
  loadPersistedDeviceMaterial,
  loadSavedServer,
  normalizeSessionMode,
  refreshTokenStorageKey,
  restoreSession,
  runtimePlatform,
  savePersistedDeviceMaterial,
  safeStoreDelete,
  safeStoreGet,
  safeStoreSet,
  secretVault,
  serverStorageKey,
  sessionModeStorageKey,
  syncCursorStorageKey,
  toUserError,
} from "./bootstrap-utils";
import {
  applyOwnMessageFallback,
  applySyncBatch,
  base64ToBytes,
  collectRecipients,
  decodeMessage,
  upsertMessageItems,
  uploadEncryptedAttachments,
} from "./message-helpers";
import type {
  AuthMode,
  ChatFilter,
  DeviceMaterial,
  MessageAttachmentView,
  MessageBucket,
  SavedServer,
  SessionMode,
  SessionState,
  SettingsSection as SettingsSectionKey,
  UploadDraft,
  UploadFeedback,
} from "./types";
import {
  normalizeProgress,
  normalizeUserSearchInput,
  renderNotificationTitle,
  resolveConversationTitle,
  sectionSubtitle,
  sectionTitle,
} from "./view-utils";
import {
  loadFeed,
  loadNotifications,
  loadProfilePosts,
  loadProfileState,
  loadSettingsData,
  loadSummaries,
} from "./data-loaders";

const emptyTransportState: RuntimeTransportState = {
  mode: "none",
  status: "offline",
  endpoint: null,
  lastError: null,
  lastCursor: 0,
  updatedAt: new Date().toISOString(),
};

const emptyUploadFeedback: UploadFeedback = {
  phase: "idle",
  percent: 0,
  message: "",
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
  const [settingsSection, setSettingsSection] = React.useState<SettingsSectionKey>("account");
  const [twoFASetup, setTwoFASetup] = React.useState<TwoFactorSetupStartResponse | null>(null);
  const [twoFAEnableCode, setTwoFAEnableCode] = React.useState("");
  const [twoFADisableCode, setTwoFADisableCode] = React.useState("");
  const [settingsMessage, setSettingsMessage] = React.useState("");
  const [profileMediaUpload, setProfileMediaUpload] = React.useState<{
    avatar: UploadFeedback;
    banner: UploadFeedback;
  }>({
    avatar: emptyUploadFeedback,
    banner: emptyUploadFeedback,
  });
  const [postMediaUpload, setPostMediaUpload] = React.useState<UploadFeedback>(emptyUploadFeedback);

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
  const sendingConversationsRef = React.useRef<Set<string>>(new Set());

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
      void loadFeed(api, session, setPosts, setPostsLoading, setPostsError, toUserError);
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
      await ensureDeviceMaterial(session.deviceId);
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
  }, [api, session?.accessToken, session?.deviceId, activeConversationId, ensureDeviceMaterial]);

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

  async function ensureDeviceMaterial(expectedDeviceId?: string): Promise<DeviceMaterial> {
    if (deviceMaterialRef.current) return deviceMaterialRef.current;
    const restored = await loadPersistedDeviceMaterial(expectedDeviceId);
    if (restored) {
      deviceMaterialRef.current = restored;
      return restored;
    }
    if (expectedDeviceId) {
      throw new Error("Локальный ключ устройства не найден. Выйдите и войдите снова.");
    }
    const pair = await webCryptoProvider.generateIdentityKeyPair();
    const device: DeviceMaterial = {
      name: browserDeviceName(),
      platform: "web-browser",
      publicKey: pair.publicKey,
      privateKey: pair.privateKey,
    };
    deviceMaterialRef.current = device;
    await savePersistedDeviceMaterial(device, sessionMode, expectedDeviceId);
    return device;
  }

  async function resetDeviceMaterial(): Promise<void> {
    deviceMaterialRef.current = null;
    await clearPersistedDeviceMaterial();
  }

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

  React.useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void ensureDeviceMaterial(session.deviceId).then((device) => {
      if (!cancelled) {
        deviceMaterialRef.current = device;
      }
    }).catch(() => {
      // noop
    });
    return () => {
      cancelled = true;
    };
  }, [session?.deviceId, ensureDeviceMaterial]);

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
      if (deviceMaterialRef.current) {
        await savePersistedDeviceMaterial(deviceMaterialRef.current, sessionMode, next.deviceId);
      }

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
      if (deviceMaterialRef.current) {
        await savePersistedDeviceMaterial(deviceMaterialRef.current, sessionMode, next.deviceId);
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
        await resetDeviceMaterial();
        setPending2fa(null);
        await execute();
        return;
      }
      throw error;
    }
  };

  const submit2fa = async (code: string) => {
    if (!api || !pending2fa) throw new Error("Челлендж 2FA не найден.");
    const device = await ensureDeviceMaterial();
    const response = await api.verifyWeb2FA({
      challengeId: pending2fa.challengeId,
      loginToken: pending2fa.loginToken,
      code,
      device: {
        name: device.name,
        platform: device.platform,
        publicDeviceMaterial: device.publicKey,
      },
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
        const device = await ensureDeviceMaterial(session.deviceId);
        const history = await api.listConversationMessages(session.accessToken, conversationId, { limit: 60 });
        const decoded = await Promise.all(
          history.messages.map((message) => decodeMessage(message, session, device)),
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
    if (sendingConversationsRef.current.has(conversationId)) return;
    sendingConversationsRef.current.add(conversationId);

    const optimisticId = `local_${Date.now()}_${Math.random().toString(16).slice(2)}`;
    setMessagesByConversation((prev) => {
      const bucket = prev[conversationId] ?? { loading: false, error: "", items: [] };
      return {
        ...prev,
        [conversationId]: {
          ...bucket,
          items: upsertMessageItems(bucket.items, [
            {
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
            },
          ]),
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
      const mappedWithFallback = applyOwnMessageFallback(mapped, text, response.message.envelope.attachments, attachmentSecrets);
      setMessagesByConversation((prev) => {
        const bucket = prev[conversationId] ?? { loading: false, error: "", items: [] };
        return {
          ...prev,
          [conversationId]: {
            ...bucket,
            items: upsertMessageItems(
              bucket.items.filter((item) => item.id !== optimisticId),
              [mappedWithFallback],
            ),
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
    } finally {
      sendingConversationsRef.current.delete(conversationId);
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

  const setProfileUploadState = React.useCallback(
    (kind: "avatar" | "banner", next: UploadFeedback) => {
      setProfileMediaUpload((prev) => ({
        ...prev,
        [kind]: next,
      }));
    },
    [setProfileMediaUpload],
  );

  const publishPost = async (payload: CreatePostPayload) => {
    if (!api || !session) throw new Error("Сессия не активна.");
    setPostMediaUpload(emptyUploadFeedback);

    let mediaId: string | undefined;
    try {
      if (payload.mediaFile) {
        setPostMediaUpload({
          phase: "uploading",
          percent: 0,
          message: "Загружаем медиа: 0%",
        });
        const uploaded = await api.uploadMedia(session.accessToken, {
          file: payload.mediaFile,
          domain: "social",
          kind: payload.mediaType === "video" ? "video" : "photo",
          visibility: "friends",
          onProgress: ({ percent }) => {
            const normalized = normalizeProgress(percent);
            setPostMediaUpload({
              phase: "uploading",
              percent: normalized,
              message: `Загружаем медиа: ${normalized}%`,
            });
          },
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
      if (payload.mediaFile) {
        setPostMediaUpload({
          phase: "success",
          percent: 100,
          message: "Медиа успешно загружено и опубликовано.",
        });
      }
    } catch (error) {
      if (payload.mediaFile) {
        setPostMediaUpload({
          phase: "error",
          percent: 0,
          message: toUserError(error),
        });
      }
      throw error;
    }
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
    const uploadLabel = kind === "avatar" ? "аватар" : "обложку";
    try {
      setProfileUploadState(kind, {
        phase: "uploading",
        percent: 0,
        message: `Загружаем ${uploadLabel}: 0%`,
      });

      const uploaded = await api.uploadMedia(session.accessToken, {
        file,
        domain: "profile",
        kind,
        visibility: "public",
        onProgress: ({ percent }) => {
          const normalized = normalizeProgress(percent);
          setProfileUploadState(kind, {
            phase: "uploading",
            percent: normalized,
            message: `Загружаем ${uploadLabel}: ${normalized}%`,
          });
        },
      });
      const response = await api.updateMyProfile(session.accessToken, {
        avatarMediaId: kind === "avatar" ? uploaded.media.id : undefined,
        bannerMediaId: kind === "banner" ? uploaded.media.id : undefined,
      });
      setMyProfile(response.profile);
      setProfileUploadState(kind, {
        phase: "success",
        percent: 100,
        message: kind === "avatar" ? "Аватар успешно загружен." : "Обложка успешно загружена.",
      });
      setSettingsMessage(kind === "avatar" ? "Аватар обновлён." : "Обложка обновлена.");
    } catch (error) {
      setProfileUploadState(kind, {
        phase: "error",
        percent: 0,
        message: toUserError(error),
      });
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
    await clearPersistedDeviceMaterial();
    localStorage.removeItem(serverStorageKey);
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    deviceMaterialRef.current = null;
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
            <MessagesSection
              conversationSearch={conversationSearch}
              onConversationSearchChange={setConversationSearch}
              conversationFilter={conversationFilter}
              onConversationFilterChange={setConversationFilter}
              showNewChat={showNewChat}
              onToggleNewChat={() => setShowNewChat((v) => !v)}
              userSearchQuery={userSearchQuery}
              onUserSearchChange={(value) => {
                void searchUsers(value);
              }}
              userSearchResults={userSearchResults}
              groupMembers={groupMembers}
              onToggleGroupMember={(accountId) =>
                setGroupMembers((prev) =>
                  prev.includes(accountId) ? prev.filter((id) => id !== accountId) : [...prev, accountId],
                )
              }
              onCreateDirect={(accountId) => {
                void createDirect(accountId);
              }}
              groupTitle={groupTitle}
              onGroupTitleChange={setGroupTitle}
              onCreateGroup={() => {
                void createGroup();
              }}
              summariesLoading={summariesLoading}
              summariesError={summariesError}
              summaries={summaries}
              filteredSummaries={filteredSummaries}
              activeConversationId={activeConversationId}
              unreadByConversation={unreadByConversation}
              onOpenConversation={(conversationId) => {
                void openConversation(conversationId);
              }}
              resolveConversationTitle={resolveConversationTitle}
              onRefreshSummaries={() => {
                if (!api) return;
                void loadSummaries(api, session, setSummaries, setSummariesLoading, setSummariesError, setActiveConversationId);
              }}
              activeBucket={activeBucket}
              messageScrollRef={messageScrollRef}
              attachmentInputRef={attachmentInputRef}
              draftText={activeConversationId ? drafts[activeConversationId] ?? "" : ""}
              onDraftChange={(value) => {
                if (!activeConversationId) return;
                setDrafts((prev) => ({ ...prev, [activeConversationId]: value }));
              }}
              uploads={activeConversationId ? uploadsByConversation[activeConversationId] ?? [] : []}
              onAddUpload={(files) => {
                if (!activeConversationId) return;
                addUpload(activeConversationId, files);
              }}
              onRemoveUpload={(uploadId) => {
                if (!activeConversationId) return;
                removeUpload(activeConversationId, uploadId);
              }}
              onSendMessage={() => {
                if (!activeConversationId) return;
                void sendMessage(activeConversationId);
              }}
              onResendMessage={(retryText) => {
                if (!activeConversationId) return Promise.resolve();
                return sendMessage(activeConversationId, retryText);
              }}
              onDownloadAttachment={downloadAttachment}
              attachmentOps={attachmentOps}
              transportState={transportState}
              serverInput={server.input}
            />
          ) : null}

          {section === "feed" ? (
            <FeedSection
              postsLoading={postsLoading}
              postsError={postsError}
              posts={posts}
              accessToken={session.accessToken}
              uploadStatus={postMediaUpload}
              onSubmit={publishPost}
              onToggleLike={toggleLike}
              onDeletePost={deletePost}
              onOpenProfile={openUserProfile}
            />
          ) : null}

{section === "explore" ? (
            <ExploreSearchPanel
              query={exploreQuery}
              onQueryChange={setExploreQuery}
              onSubmit={() => void runExploreSearch()}
              loading={exploreLoading}
              hasSearched={exploreHasSearched}
              users={exploreUsers}
              posts={explorePosts}
              accessToken={session.accessToken}
              onOpenProfile={openUserProfile}
              onCreateDirect={createDirect}
              onSendFriendRequest={sendFriendRequest}
              onToggleLike={toggleLike}
              onDeletePost={deletePost}
            />
          ) : null}

                    {section === "notifications" ? (
            <NotificationsSection notifications={notifications} renderTitle={renderNotificationTitle} />
          ) : null}

{section === "profile" ? (
            <section className="space-y-4">
              <ProfileHeader
                profile={viewedProfile}
                banner={
                  <>
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
                  </>
                }
                avatar={
                  viewedProfile?.avatarMediaId ? (
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
                  )
                }
                actions={
                  profileTarget ? (
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
                  ) : null
                }
              />
              <ProfileStats
                postsCount={viewedProfile?.postCount ?? 0}
                storiesCount={stories.length}
                friendsCount={viewedProfile?.friendCount ?? friends.length}
              />

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
                    <div className="grid gap-2 md:grid-cols-2">
                      <UploadStatusPill label="Аватар" status={profileMediaUpload.avatar} />
                      <UploadStatusPill label="Обложка" status={profileMediaUpload.banner} />
                    </div>
                  </div>

                  <div className="rounded-2xl border p-4 space-y-3" style={cardStyle}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        value={storyCaption}
                        onChange={(event) => setStoryCaption(event.target.value)}
                        placeholder="Подпись к истории"
                        className="flex-1 min-w-[220px] rounded-lg border bg-transparent px-3 py-2 outline-none"
                        style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
                      />
                      <label className="px-3 py-2 rounded-lg border cursor-pointer" style={outlineButtonStyle}>
                        Добавить историю
                        <input
                          type="file"
                          className="hidden"
                          accept="image/*,video/*"
                          onChange={(event) => {
                            const file = event.target.files?.[0];
                            if (file) void createStory(file);
                            event.currentTarget.value = "";
                          }}
                        />
                      </label>
                    </div>
                    <StoryFeed
                      title="Истории"
                      subtitle="Публикации, которые исчезают через 24 часа"
                      stories={stories.slice(0, 8)}
                      loading={false}
                      error=""
                      emptyText="Историй пока нет."
                      onDeleteStory={async (storyId) => {
                        if (!api || !session) return;
                        try {
                          await api.deleteStory(session.accessToken, storyId);
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
                        } catch (error) {
                          setGlobalError(toUserError(error));
                        }
                      }}
                    />
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
                <ProfilePostsSection
                  posts={profilePosts}
                  loading={profileLoading}
                  error=""
                  accessToken={session.accessToken}
                  onOpenProfile={openUserProfile}
                  onToggleLike={toggleLike}
                  onDelete={deletePost}
                  title={profileTarget ? "Публикации пользователя" : "Мои публикации"}
                />
              ) : (
                <InlineInfo text="Публикации этого профиля скрыты настройками приватности." />
              )}
            </section>
          ) : null}

                    {section === "settings" ? (
            <SettingsPanel
              settingsSection={settingsSection}
              onSettingsSectionChange={setSettingsSection}
              settingsMessage={settingsMessage}
              sessionEmail={session.email}
              sessionMode={sessionMode}
              onLogout={(all) => {
                void logout(all);
              }}
              sessionInfo={sessionInfo}
              deviceList={deviceList}
              onRevokeDevice={(deviceId) => {
                void revokeDevice(deviceId);
              }}
              twoFASetup={twoFASetup}
              twoFAEnableCode={twoFAEnableCode}
              onTwoFAEnableCodeChange={setTwoFAEnableCode}
              onStartTwoFactorSetup={() => {
                void startTwoFactorSetup();
              }}
              onConfirmTwoFactorSetup={() => {
                void confirmTwoFactorSetup();
              }}
              twoFADisableCode={twoFADisableCode}
              onTwoFADisableCodeChange={setTwoFADisableCode}
              onDisableTwoFactor={() => {
                void disableTwoFactor();
              }}
              securityEvents={securityEvents}
              privacy={privacy}
              onPrivacyPatch={(patch) => {
                setPrivacy((prev) => (prev ? { ...prev, ...patch } : prev));
              }}
              onSavePrivacy={() => {
                if (!api || !session || !privacy) return;
                void (async () => {
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
                })();
              }}
              serverInput={server.input}
              onTestConnection={() => {
                void testConnection();
              }}
              onResetServer={() => {
                void resetServer();
              }}
            />
          ) : null}

        </main>
      </div>
    </div>
  );
}

export default App;
