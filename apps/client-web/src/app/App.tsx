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
import { Toaster, toast } from "sonner";

import { webCryptoProvider } from "../features/messaging/crypto";
import { WebMessagingRuntime, type RuntimeTransportState } from "../features/messaging/runtime";
import { ApiClientError, WebApiClient, type WebDevicePayload } from "../shared/api/client";
import { AuthenticatedImage } from "./components/AuthenticatedImage";
import type { CreatePostPayload } from "./components/CreatePost";
import { ExploreSearchPanel } from "./components/ExploreSearchPanel";
import { ProfileHeader } from "./components/ProfileHeader";
import { ProfilePostsSection } from "./components/ProfilePostsSection";
import { ProfileStats } from "./components/ProfileStats";
import { BottomNav } from "./components/BottomNav";
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
  hasCompatibleRecipientDevices,
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

const browserNotificationsPrefKey = "secure-messenger-web-browser-notifications";

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
  const [attachmentPreviews, setAttachmentPreviews] = React.useState<
    Record<string, { loading: boolean; src: string | null; error: string }>
  >({});

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
  const [notificationsUnreadTotal, setNotificationsUnreadTotal] = React.useState(0);
  const [notificationsLoading, setNotificationsLoading] = React.useState(false);
  const [notificationsError, setNotificationsError] = React.useState("");
  const [preferBrowserNotifications, setPreferBrowserNotifications] = React.useState(false);
  const [browserNotificationPermission, setBrowserNotificationPermission] = React.useState<NotificationPermission>(
    typeof window !== "undefined" && "Notification" in window ? Notification.permission : "default",
  );
  const [showMobileConversationList, setShowMobileConversationList] = React.useState(true);

  const [sessionInfo, setSessionInfo] = React.useState<AuthSessionResponse | null>(null);
  const [deviceList, setDeviceList] = React.useState<DeviceListResponse | null>(null);
  const [securityEvents, setSecurityEvents] = React.useState<SecurityEventsResponse["events"]>([]);

  const runtimeRef = React.useRef<WebMessagingRuntime | null>(null);
  const deviceMaterialRef = React.useRef<DeviceMaterial | null>(null);
  const activeConversationIdRef = React.useRef<string | null>(null);
  const messagesByConversationRef = React.useRef<Record<string, MessageBucket>>({});
  const shownToastNotificationIDsRef = React.useRef<Set<string>>(new Set());
  const knownNotificationIDsRef = React.useRef<Set<string>>(new Set());
  const preferBrowserNotificationsRef = React.useRef(false);
  const browserNotificationPermissionRef = React.useRef<NotificationPermission>("default");
  const messageScrollRef = React.useRef<HTMLDivElement | null>(null);
  const attachmentInputRef = React.useRef<HTMLInputElement | null>(null);
  const sendingConversationsRef = React.useRef<Set<string>>(new Set());
  const readReceiptInFlightRef = React.useRef<Set<string>>(new Set());
  const attachmentPreviewUrlsRef = React.useRef<Map<string, string>>(new Map());
  const attachmentPreviewInFlightRef = React.useRef<Set<string>>(new Set());
  const attachmentSecretsByIdRef = React.useRef<Map<string, { symmetricKey: string; nonce: string }>>(new Map());

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

  const clearAttachmentPreviews = React.useCallback(() => {
    for (const url of attachmentPreviewUrlsRef.current.values()) {
      URL.revokeObjectURL(url);
    }
    attachmentPreviewUrlsRef.current.clear();
    attachmentPreviewInFlightRef.current.clear();
    setAttachmentPreviews({});
  }, []);

  const clearAttachmentSecretsCache = React.useCallback(() => {
    attachmentSecretsByIdRef.current.clear();
  }, []);

  const refreshNotifications = React.useCallback(async () => {
    if (!api || !session) return;
    await loadNotifications(
      api,
      session,
      setNotifications,
      setNotificationsUnreadTotal,
      setNotificationsLoading,
      setNotificationsError,
      toUserError,
    );
  }, [api, session?.accessToken]);

  React.useEffect(() => {
    let cancelled = false;
    const boot = async () => {
      const storedMode = await safeStoreGet(sessionModeStorageKey);
      const mode = normalizeSessionMode(storedMode) ?? (runtimePlatform.sessionPolicy.persistence as SessionMode);
      if (cancelled) return;
      setSessionMode(mode);
      try {
        const storedBrowserPref = localStorage.getItem(browserNotificationsPrefKey);
        if (storedBrowserPref === "enabled") {
          setPreferBrowserNotifications(true);
        }
      } catch {
        // noop
      }
      if (typeof window !== "undefined" && "Notification" in window) {
        setBrowserNotificationPermission(Notification.permission);
      }

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
    void refreshNotifications();
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
  }, [api, session?.accessToken, refreshNotifications]);

  React.useEffect(() => {
    if (!api || !session) return;
    if (section === "feed") {
      void loadFeed(api, session, setPosts, setPostsLoading, setPostsError, toUserError);
    }
    if (section === "notifications") {
      void refreshNotifications();
    }
    if (section === "profile") {
      void loadProfilePosts(api, session, setProfilePosts, setProfileLoading, profileTarget?.accountId as string | undefined);
    }
  }, [section, api, session?.accessToken, profileTarget?.accountId, refreshNotifications]);

  React.useEffect(() => {
    activeConversationIdRef.current = activeConversationId;
  }, [activeConversationId]);

  React.useEffect(() => {
    messagesByConversationRef.current = messagesByConversation;
  }, [messagesByConversation]);

  React.useEffect(() => {
    const attachmentIDs = new Set<string>();
    for (const bucket of Object.values(messagesByConversation)) {
      for (const message of bucket.items) {
        for (const attachment of message.attachments) {
          attachmentIDs.add(attachment.id);
          if (attachment.symmetricKey) {
            attachmentSecretsByIdRef.current.set(attachment.id, {
              symmetricKey: attachment.symmetricKey,
              nonce: attachment.nonce,
            });
          }
        }
      }
    }

    let removedAny = false;
    for (const [attachmentId, url] of attachmentPreviewUrlsRef.current.entries()) {
      if (attachmentIDs.has(attachmentId)) continue;
      URL.revokeObjectURL(url);
      attachmentPreviewUrlsRef.current.delete(attachmentId);
      removedAny = true;
    }
    if (!removedAny) return;

    setAttachmentPreviews((prev) => {
      let changed = false;
      const next: Record<string, { loading: boolean; src: string | null; error: string }> = {};
      for (const [attachmentId, value] of Object.entries(prev)) {
        if (!attachmentIDs.has(attachmentId)) {
          changed = true;
          continue;
        }
        next[attachmentId] = value;
      }
      return changed ? next : prev;
    });
  }, [messagesByConversation]);

  React.useEffect(() => () => clearAttachmentPreviews(), [clearAttachmentPreviews]);

  React.useEffect(() => {
    preferBrowserNotificationsRef.current = preferBrowserNotifications;
  }, [preferBrowserNotifications]);

  React.useEffect(() => {
    browserNotificationPermissionRef.current = browserNotificationPermission;
  }, [browserNotificationPermission]);

  React.useEffect(() => {
    if (!api || !session) return;
    const handle = window.setInterval(() => {
      void refreshNotifications();
    }, 20_000);
    return () => window.clearInterval(handle);
  }, [api, session?.accessToken, refreshNotifications]);

  React.useEffect(() => {
    if (notificationsLoading) return;
    const currentIDs = new Set(notifications.map((item) => item.id as string));
    if (knownNotificationIDsRef.current.size === 0) {
      knownNotificationIDsRef.current = currentIDs;
      return;
    }

    for (const item of notifications) {
      const id = item.id as string;
      if (knownNotificationIDsRef.current.has(id)) {
        continue;
      }
      if (item.isRead || section === "notifications") {
        continue;
      }
      const toastID = `notif:${id}`;
      if (shownToastNotificationIDsRef.current.has(toastID)) {
        continue;
      }
      shownToastNotificationIDsRef.current.add(toastID);
      toast(renderNotificationTitle(item), {
        description: item.preview ?? "РћС‚РєСЂРѕР№С‚Рµ СѓРІРµРґРѕРјР»РµРЅРёРµ",
        action: {
          label: "РћС‚РєСЂС‹С‚СЊ",
          onClick: () => {
            void openNotification(item);
          },
        },
      });
      if (
        preferBrowserNotificationsRef.current &&
        browserNotificationPermissionRef.current === "granted" &&
        typeof window !== "undefined" &&
        "Notification" in window
      ) {
        try {
          const browserNotification = new Notification(renderNotificationTitle(item), {
            body: item.preview ?? "РћС‚РєСЂРѕР№С‚Рµ СѓРІРµРґРѕРјР»РµРЅРёРµ",
          });
          browserNotification.onclick = () => {
            window.focus();
            void openNotification(item);
            browserNotification.close();
          };
        } catch {
          // noop
        }
      }
    }

    knownNotificationIDsRef.current = currentIDs;
  }, [notifications, notificationsLoading, section]);

  React.useEffect(() => {
    if (section !== "messages") {
      setShowMobileConversationList(true);
      return;
    }
    if (!activeConversationId) {
      setShowMobileConversationList(true);
    }
  }, [section, activeConversationId]);

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
            const mapped = await applySyncBatch(
              batch,
              session,
              deviceMaterialRef.current,
              activeConversationIdRef.current,
              messagesByConversationRef.current,
              setMessagesByConversation,
              setUnreadByConversation,
            );
            await safeStoreSet(syncCursorStorageKey, String(batch.toCursor));
            const activeID = activeConversationIdRef.current;
            const incoming = mapped.filter((item) => !item.own && item.conversationId !== activeID);
            for (const item of incoming.slice(0, 3)) {
              const toastID = `msg:${item.id}`;
              if (shownToastNotificationIDsRef.current.has(toastID)) {
                continue;
              }
              shownToastNotificationIDsRef.current.add(toastID);
              toast("РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ", {
                description: item.text || "РћС‚РєСЂРѕР№С‚Рµ С‡Р°С‚, С‡С‚РѕР±С‹ РїСЂРѕС‡РёС‚Р°С‚СЊ.",
                action: {
                  label: "РћС‚РєСЂС‹С‚СЊ",
                  onClick: () => {
                    setSection("messages");
                    setShowMobileConversationList(false);
                    void openConversation(item.conversationId);
                  },
                },
              });
              if (
                preferBrowserNotificationsRef.current &&
                browserNotificationPermissionRef.current === "granted" &&
                typeof window !== "undefined" &&
                "Notification" in window
              ) {
                try {
                  const browserNotification = new Notification("РќРѕРІРѕРµ СЃРѕРѕР±С‰РµРЅРёРµ", {
                    body: item.text || "РћС‚РєСЂРѕР№С‚Рµ С‡Р°С‚, С‡С‚РѕР±С‹ РїСЂРѕС‡РёС‚Р°С‚СЊ.",
                  });
                  browserNotification.onclick = () => {
                    window.focus();
                    setSection("messages");
                    setShowMobileConversationList(false);
                    void openConversation(item.conversationId);
                    browserNotification.close();
                  };
                } catch {
                  // noop
                }
              }
            }
          }
        },
        onTransport: (state) => {
          if (disposed) return;
          setTransportState(state);
          if (state.status === "connected" || (state.status === "degraded" && !state.lastError)) {
            setRuntimeError("");
          }
        },
        onError: (message) => {
          if (!disposed) setRuntimeError(message);
        },
      });
      runtimeRef.current = runtime;
      await runtime.start(Number.isFinite(initialCursor) ? initialCursor : 0);
    };

    void startRuntime().catch(async (error) => {
      if (disposed) return;
      const message = toUserError(error);
      if (message.toLowerCase().includes("РєР»СЋС‡ СѓСЃС‚СЂРѕР№СЃС‚РІР°")) {
        await clearAuthState();
        await clearPersistedDeviceMaterial();
        clearSignedInState();
        setGlobalError("РЎРµСЃСЃРёСЏ С‚СЂРµР±СѓРµС‚ РїРѕРІС‚РѕСЂРЅРѕРіРѕ РІС…РѕРґР°. Р’РѕР№РґРёС‚Рµ СЃРЅРѕРІР°.");
        return;
      }
      setRuntimeError(message);
    });

    return () => {
      disposed = true;
      runtimeRef.current?.stop();
      runtimeRef.current = null;
    };
  }, [api, session?.accessToken, session?.deviceId]);

  React.useEffect(() => {
    if (!activeConversationId) return;
    setUnreadByConversation((current) => ({ ...current, [activeConversationId]: 0 }));
    const bucket = messagesByConversation[activeConversationId];
    if (!bucket || bucket.items.length === 0) return;
    void markConversationMessagesRead(activeConversationId, bucket.items);
    const el = messageScrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
    if (nearBottom) {
      el.scrollTop = el.scrollHeight;
    }
  }, [activeConversationId, messagesByConversation, api, session?.accessToken]);

  async function ensureDeviceMaterial(expectedDeviceId?: string): Promise<DeviceMaterial> {
    if (deviceMaterialRef.current) return deviceMaterialRef.current;
    const restored = await loadPersistedDeviceMaterial(expectedDeviceId);
    if (restored) {
      deviceMaterialRef.current = restored;
      return restored;
    }
    if (expectedDeviceId) {
      throw new Error("Р›РѕРєР°Р»СЊРЅС‹Р№ РєР»СЋС‡ СѓСЃС‚СЂРѕР№СЃС‚РІР° РЅРµ РЅР°Р№РґРµРЅ. Р’С‹Р№РґРёС‚Рµ Рё РІРѕР№РґРёС‚Рµ СЃРЅРѕРІР°.");
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

  function clearSignedInState(): void {
    runtimeRef.current?.stop();
    runtimeRef.current = null;
    deviceMaterialRef.current = null;
    setSession(null);
    setPending2fa(null);
    setSummaries([]);
    setConversationDetails({});
    setMessagesByConversation({});
    messagesByConversationRef.current = {};
    setDrafts({});
    setUploadsByConversation({});
    setUnreadByConversation({});
    setAttachmentOps({});
    clearAttachmentPreviews();
    clearAttachmentSecretsCache();
    setMyProfile(null);
    setProfileTarget(null);
    setProfilePosts([]);
    setFriends([]);
    setIncomingRequests([]);
    setOutgoingRequests([]);
    setPrivacy(null);
    setStories([]);
    setNotifications([]);
    setNotificationsUnreadTotal(0);
    setNotificationsError("");
    setNotificationsLoading(false);
    knownNotificationIDsRef.current = new Set();
    shownToastNotificationIDsRef.current = new Set();
    readReceiptInFlightRef.current = new Set();
    setSection("messages");
  }

  React.useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void ensureDeviceMaterial(session.deviceId).then((device) => {
      if (!cancelled) {
        deviceMaterialRef.current = device;
      }
    }).catch(async (error) => {
      if (cancelled) return;
      await clearAuthState();
      await clearPersistedDeviceMaterial();
      clearSignedInState();
      setGlobalError(toUserError(error));
    });
    return () => {
      cancelled = true;
    };
  }, [session?.deviceId]);

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
        setGlobalError("РЎРµСЃСЃРёСЏ РёСЃС‚РµРєР»Р°. Р’РѕР№РґРёС‚Рµ СЃРЅРѕРІР°.");
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
    if (!api) throw new Error("Connect to server first.");

    const normalizedEmail = email.trim();
    if (!normalizedEmail) {
      throw new Error("Email is required.");
    }
    if (mode === "register" && password.length < 10) {
      throw new Error("Password must be at least 10 characters.");
    }

    const execute = async () => {
      const device = await ensureDeviceMaterial();
      const payload: WebDevicePayload = {
        name: device.name,
        platform: device.platform,
        publicDeviceMaterial: device.publicKey,
      };

      if (mode === "register") {
        const response = await api.registerWeb({
          email: normalizedEmail,
          password,
          device: payload,
          sessionPersistence: sessionMode,
        });
        await applySession(response, normalizedEmail);
        return;
      }

      const response = await api.loginWeb({
        email: normalizedEmail,
        password,
        device: payload,
        sessionPersistence: sessionMode,
      });
      if ("challengeId" in response) {
        setPending2fa(response);
        return;
      }
      await applySession(response, normalizedEmail);
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
    if (!api || !pending2fa) throw new Error("Р§РµР»Р»РµРЅРґР¶ 2FA РЅРµ РЅР°Р№РґРµРЅ.");
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

  async function markConversationMessagesRead(
    conversationId: string,
    items: Array<{ id: string; own: boolean; readByMe: boolean }>,
  ): Promise<void> {
    if (!api || !session) return;
    const candidates = items
      .filter((item) => !item.own && !item.readByMe)
      .map((item) => item.id)
      .filter((id) => !readReceiptInFlightRef.current.has(id));
    if (candidates.length === 0) return;

    for (const id of candidates) {
      readReceiptInFlightRef.current.add(id);
    }

    const succeeded = new Set<string>();
    try {
      await Promise.all(
        candidates.map(async (id) => {
          try {
            await api.createReceipt(session.accessToken, id, "read");
            succeeded.add(id);
          } catch {
            // keep processing other messages; failed ones can be retried later
          }
        }),
      );
    } finally {
      for (const id of candidates) {
        readReceiptInFlightRef.current.delete(id);
      }
    }

    if (succeeded.size > 0) {
      setMessagesByConversation((prev) => {
        const bucket = prev[conversationId];
        if (!bucket) return prev;
        const nextItems = bucket.items.map((item) =>
          succeeded.has(item.id) ? { ...item, readByMe: true } : item,
        );
        return {
          ...prev,
          [conversationId]: {
            ...bucket,
            items: nextItems,
          },
        };
      });
    }
  }

  const openConversation = async (conversationId: string) => {
    setActiveConversationId(conversationId);
    setShowMobileConversationList(false);
    setUnreadByConversation((current) => ({ ...current, [conversationId]: 0 }));
    if (!api || !session) return;

    if (!conversationDetails[conversationId]) {
      const details = await api.getConversation(session.accessToken, conversationId);
      setConversationDetails((prev) => ({ ...prev, [conversationId]: details.conversation }));
    }

    const existingBucket = messagesByConversation[conversationId];
    if (!existingBucket || existingBucket.error) {
      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationId]: { loading: true, error: "", items: [], hasMore: false, nextCursor: 0, loadingMore: false },
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
            hasMore: history.nextCursor > 0,
            nextCursor: history.nextCursor,
            loadingMore: false,
          },
        }));
        void markConversationMessagesRead(conversationId, decoded);
      } catch (error) {
        setMessagesByConversation((prev) => ({
          ...prev,
          [conversationId]: { loading: false, error: toUserError(error), items: [], hasMore: false, nextCursor: 0, loadingMore: false },
        }));
      }
    } else {
      void markConversationMessagesRead(conversationId, existingBucket.items);
    }
  };

  const loadOlderMessages = async (conversationId: string) => {
    if (!api || !session) return;
    const bucket = messagesByConversation[conversationId];
    const cursor = bucket?.nextCursor ?? 0;
    if (!bucket || bucket.loading || bucket.loadingMore || !bucket.hasMore || cursor <= 0) {
      return;
    }

    setMessagesByConversation((prev) => ({
      ...prev,
      [conversationId]: {
        ...prev[conversationId],
        loadingMore: true,
        error: "",
      },
    }));

    try {
      const device = await ensureDeviceMaterial(session.deviceId);
      const history = await api.listConversationMessages(session.accessToken, conversationId, {
        limit: 60,
        beforeSequence: cursor,
      });
      const decoded = await Promise.all(history.messages.map((message) => decodeMessage(message, session, device)));
      setMessagesByConversation((prev) => {
        const currentBucket = prev[conversationId] ?? { loading: false, error: "", items: [] as typeof decoded };
        return {
          ...prev,
          [conversationId]: {
            ...currentBucket,
            loading: false,
            loadingMore: false,
            error: "",
            hasMore: history.nextCursor > 0,
            nextCursor: history.nextCursor,
            items: upsertMessageItems(currentBucket.items, decoded),
          },
        };
      });
    } catch (error) {
      setMessagesByConversation((prev) => ({
        ...prev,
        [conversationId]: {
          ...(prev[conversationId] ?? { loading: false, items: [] }),
          loading: false,
          loadingMore: false,
          error: toUserError(error),
        },
      }));
    }
  };

  React.useEffect(() => {
    if (!activeConversationId || !api || !session) return;
    const bucket = messagesByConversation[activeConversationId];
    if (bucket && !bucket.error) return;
    void openConversation(activeConversationId);
  }, [activeConversationId, api, session?.accessToken, messagesByConversation]);

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
      const baseItems =
        retryText !== undefined
          ? bucket.items.filter((item) => !(item.localStatus === "failed" && (item.retryText ?? "") === text))
          : bucket.items;
      return {
        ...prev,
        [conversationId]: {
          ...bucket,
          items: upsertMessageItems(baseItems, [
            {
              id: optimisticId,
              conversationId,
              senderAccountId: session.accountId,
              createdAt: new Date().toISOString(),
              editedAt: null,
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
              readByMe: true,
              readByOthersAt: null,
              localStatus: "sending",
            },
          ]),
        },
      };
    });

    try {
      const details = conversationDetails[conversationId] ?? (await api.getConversation(session.accessToken, conversationId)).conversation;
      if (!hasCompatibleRecipientDevices(details.members, session.accountId)) {
        throw new Error("РЈ РїРѕР»СѓС‡Р°С‚РµР»СЏ РЅРµС‚ СЃРѕРІРјРµСЃС‚РёРјРѕРіРѕ СѓСЃС‚СЂРѕР№СЃС‚РІР° РґР»СЏ Р·Р°С‰РёС‰РµРЅРЅС‹С… СЃРѕРѕР±С‰РµРЅРёР№. РџРѕРїСЂРѕСЃРёС‚Рµ РµРіРѕ Р·Р°РЅРѕРІРѕ РІРѕР№С‚Рё РІ РїСЂРёР»РѕР¶РµРЅРёРµ.");
      }
      const recipients = collectRecipients(details.members);
      if (recipients.length === 0) throw new Error("РќРµС‚ РґРѕСЃС‚СѓРїРЅС‹С… СѓСЃС‚СЂРѕР№СЃС‚РІ РїРѕР»СѓС‡Р°С‚РµР»РµР№.");
      const attachmentSecrets = await uploadEncryptedAttachments(api, session.accessToken, uploads);
      for (const secret of attachmentSecrets) {
        attachmentSecretsByIdRef.current.set(secret.attachmentId, {
          symmetricKey: secret.symmetricKey,
          nonce: secret.nonce,
        });
      }
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
      setRuntimeError(toUserError(error));
      setMessagesByConversation((prev) => {
        const bucket = prev[conversationId] ?? { loading: false, error: "", items: [] };
        return {
          ...prev,
          [conversationId]: {
            ...bucket,
            items: bucket.items.map((item) =>
              item.id === optimisticId
                ? { ...item, localStatus: "failed", retryText: text, deliveryState: "failed" }
                : item,
            ),
          },
        };
      });
    } finally {
      sendingConversationsRef.current.delete(conversationId);
    }
  };

  const editMessage = async (messageId: string, nextText: string) => {
    if (!api || !session || !activeConversationId) return;
    const conversationId = activeConversationId;
    const bucket = messagesByConversation[conversationId];
    const source = bucket?.items.find((item) => item.id === messageId);
    if (!source || !source.own || source.localStatus === "sending") {
      return;
    }

    const normalizedText = nextText.trimEnd();
    if (normalizedText === source.text) {
      return;
    }

    try {
      const detailsResponse = conversationDetails[conversationId]
        ? { conversation: conversationDetails[conversationId] }
        : await api.getConversation(session.accessToken, conversationId);
      const details = detailsResponse.conversation;
      if (!conversationDetails[conversationId]) {
        setConversationDetails((prev) => ({ ...prev, [conversationId]: details }));
      }

      if (!hasCompatibleRecipientDevices(details.members, session.accountId)) {
        throw new Error("No compatible recipient devices were found for this conversation.");
      }

      const recipients = collectRecipients(details.members);
      if (recipients.length === 0) {
        throw new Error("No available recipient devices were found.");
      }

      const attachmentSecrets = source.attachments.map((attachment) => {
        if (!attachment.symmetricKey) {
          throw new Error("Unable to edit a message with attachments that have no local decryption key.");
        }
        return {
          attachmentId: attachment.id,
          fileName: attachment.fileName,
          mimeType: attachment.mimeType,
          sizeBytes: attachment.sizeBytes,
          symmetricKey: attachment.symmetricKey,
          nonce: attachment.nonce,
          checksumSha256: attachment.checksumSha256,
          algorithm: attachment.algorithm,
        };
      });

      const plaintextPayload = JSON.stringify({
        text: normalizedText,
        attachments: attachmentSecrets,
        editedAt: new Date().toISOString(),
      });
      const encrypted = await webCryptoProvider.encryptMessage(plaintextPayload, recipients);
      const response = await api.editMessage(session.accessToken, messageId, {
        algorithm: encrypted.algorithm,
        cryptoVersion: encrypted.cryptoVersion,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        recipients: encrypted.recipients as never,
      });

      const mapped = await decodeMessage(response.message, session, deviceMaterialRef.current);
      const mappedWithFallback = applyOwnMessageFallback(
        mapped,
        normalizedText,
        response.message.envelope.attachments,
        attachmentSecrets,
      );

      setMessagesByConversation((prev) => {
        const currentBucket = prev[conversationId];
        if (!currentBucket) return prev;
        return {
          ...prev,
          [conversationId]: {
            ...currentBucket,
            items: upsertMessageItems(currentBucket.items, [mappedWithFallback]),
          },
        };
      });
      void loadSummaries(api, session, setSummaries, setSummariesLoading, setSummariesError, setActiveConversationId);
    } catch (error) {
      setRuntimeError(toUserError(error));
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

  const decryptAttachmentToBlob = async (attachment: MessageAttachmentView): Promise<Blob> => {
    if (!api || !session) {
      throw new Error("Connect to server first.");
    }
    const cachedSecret = attachmentSecretsByIdRef.current.get(attachment.id);
    const effectiveSymmetricKey = attachment.symmetricKey ?? cachedSecret?.symmetricKey ?? null;
    const effectiveNonce = attachment.nonce || cachedSecret?.nonce || "";
    if (!effectiveSymmetricKey) {
      throw new Error("Missing attachment decryption key.");
    }
    if (!effectiveNonce) {
      throw new Error("Missing attachment nonce.");
    }

    const response = await api.downloadAttachment(session.accessToken, attachment.id as never);
    const ciphertextBytes = base64ToBytes(response.ciphertext);
    let checksumMismatch = false;
    if (attachment.checksumSha256) {
      const checksum = await webCryptoProvider.hashBytesHex(ciphertextBytes);
      if (checksum.toLowerCase() !== attachment.checksumSha256.toLowerCase()) {
        checksumMismatch = true;
      }
    }
    const decrypted = await webCryptoProvider.decryptAttachment({
      ciphertext: response.ciphertext,
      nonce: effectiveNonce,
      symmetricKey: effectiveSymmetricKey,
    });
    const blobBytes = new Uint8Array(decrypted.byteLength);
    blobBytes.set(decrypted);
    if (checksumMismatch) {
      console.warn("Attachment checksum mismatch detected, but decryption succeeded", {
        attachmentId: attachment.id,
      });
    }
    return new Blob([blobBytes.buffer], { type: attachment.mimeType || "application/octet-stream" });
  };

  const ensureAttachmentPreview = async (attachment: MessageAttachmentView) => {
    if (attachment.kind !== "image") return;
    if (!attachment.symmetricKey && !attachmentSecretsByIdRef.current.has(attachment.id)) {
      setAttachmentPreviews((prev) => ({
        ...prev,
        [attachment.id]: { loading: false, src: null, error: "Image preview will be available after successful send." },
      }));
      return;
    }
    if (attachmentPreviewUrlsRef.current.has(attachment.id)) return;
    if (attachmentPreviewInFlightRef.current.has(attachment.id)) return;

    attachmentPreviewInFlightRef.current.add(attachment.id);
    setAttachmentPreviews((prev) => ({
      ...prev,
      [attachment.id]: { loading: true, src: null, error: "" },
    }));

    try {
      const blob = await decryptAttachmentToBlob(attachment);
      const url = URL.createObjectURL(blob);
      const oldURL = attachmentPreviewUrlsRef.current.get(attachment.id);
      if (oldURL) {
        URL.revokeObjectURL(oldURL);
      }
      attachmentPreviewUrlsRef.current.set(attachment.id, url);
      setAttachmentPreviews((prev) => ({
        ...prev,
        [attachment.id]: { loading: false, src: url, error: "" },
      }));
    } catch (error) {
      setAttachmentPreviews((prev) => ({
        ...prev,
        [attachment.id]: { loading: false, src: null, error: toUserError(error) },
      }));
    } finally {
      attachmentPreviewInFlightRef.current.delete(attachment.id);
    }
  };

  const downloadAttachment = async (attachment: MessageAttachmentView) => {
    if (!attachment.symmetricKey && !attachmentSecretsByIdRef.current.has(attachment.id)) {
      setAttachmentOps((prev) => ({
        ...prev,
        [attachment.id]: { loading: false, error: "Attachment key is not available yet. Send the message first." },
      }));
      return;
    }
    setAttachmentOps((prev) => ({ ...prev, [attachment.id]: { loading: true, error: "" } }));
    try {
      const blob = await decryptAttachmentToBlob(attachment);
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
    setSection("messages");
    setShowMobileConversationList(false);
    setShowNewChat(false);
    await loadSummaries(api, session, setSummaries, setSummariesLoading, setSummariesError, setActiveConversationId);
    await openConversation(conversationId);
  };

  const createGroup = async () => {
    if (!api || !session) return;
    const title = groupTitle.trim();
    if (!title || groupMembers.length === 0) {
      setGlobalError("Р’РІРµРґРёС‚Рµ РЅР°Р·РІР°РЅРёРµ РіСЂСѓРїРїС‹ Рё РІС‹Р±РµСЂРёС‚Рµ СѓС‡Р°СЃС‚РЅРёРєРѕРІ.");
      return;
    }
    const payload: CreateGroupConversationRequest = { title, memberAccountIds: groupMembers as never };
    const response = await api.createGroupConversation(session.accessToken, payload);
    const conversationId = response.conversation.id as string;
    setSection("messages");
    setShowMobileConversationList(false);
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

  const markNotificationsRead = async (ids: string[], all = false) => {
    if (!api || !session) return;
    try {
      const markedAt = new Date().toISOString();
      const response = await api.markNotificationsRead(session.accessToken, {
        ...(all ? { all: true } : {}),
        ...(ids.length > 0 ? { ids } : {}),
      });
      setNotifications((prev) =>
        prev.map((item) => {
          const shouldMark = all || ids.includes(item.id as string);
          if (!shouldMark) return item;
          return {
            ...item,
            isRead: true,
            readAt: item.readAt ?? (markedAt as never),
          };
        }),
      );
      setNotificationsUnreadTotal(response.unreadTotal);
    } catch (error) {
      setGlobalError(toUserError(error));
    }
  };

  const clearAllNotifications = async () => {
    if (!api || !session) return;
    try {
      const response = await api.clearNotifications(session.accessToken);
      setNotifications([]);
      setNotificationsUnreadTotal(response.unreadTotal);
      setNotificationsError("");
      knownNotificationIDsRef.current = new Set();
    } catch (error) {
      setGlobalError(toUserError(error));
    }
  };

  const openNotification = async (item: NotificationsResponse["notifications"][number]) => {
    if (!api || !session) return;
    const id = item.id as string;
    if (!item.isRead) {
      await markNotificationsRead([id], false);
    }

    const navigation = item.navigation;
    if (navigation?.target === "chat" && navigation.conversationId) {
      setSection("messages");
      setShowMobileConversationList(false);
      await openConversation(navigation.conversationId as string);
      return;
    }
    if (navigation?.target === "profile" && navigation.accountId) {
      await openUserProfile(navigation.accountId as string);
      return;
    }
    if (navigation?.target === "post") {
      setSection("feed");
      return;
    }
    if (navigation?.target === "friends_requests") {
      clearProfileTarget();
      setSection("profile");
      return;
    }

    if (item.actorAccountId) {
      await openUserProfile(item.actorAccountId as string);
      return;
    }
    setSection("notifications");
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
    if (!api || !session) throw new Error("РЎРµСЃСЃРёСЏ РЅРµ Р°РєС‚РёРІРЅР°.");
    setPostMediaUpload(emptyUploadFeedback);

    let mediaId: string | undefined;
    try {
      if (payload.mediaFile) {
        setPostMediaUpload({
          phase: "uploading",
          percent: 0,
          message: "Р—Р°РіСЂСѓР¶Р°РµРј РјРµРґРёР°: 0%",
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
              message: `Р—Р°РіСЂСѓР¶Р°РµРј РјРµРґРёР°: ${normalized}%`,
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
          message: "РњРµРґРёР° СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅРѕ Рё РѕРїСѓР±Р»РёРєРѕРІР°РЅРѕ.",
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
      setSettingsMessage("РџСЂРѕС„РёР»СЊ РѕР±РЅРѕРІР»С‘РЅ.");
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const uploadProfileMedia = async (file: File, kind: "avatar" | "banner") => {
    if (!api || !session) return;
    const uploadLabel = kind === "avatar" ? "Р°РІР°С‚Р°СЂ" : "РѕР±Р»РѕР¶РєСѓ";
    try {
      setProfileUploadState(kind, {
        phase: "uploading",
        percent: 0,
        message: `Р—Р°РіСЂСѓР¶Р°РµРј ${uploadLabel}: 0%`,
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
            message: `Р—Р°РіСЂСѓР¶Р°РµРј ${uploadLabel}: ${normalized}%`,
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
        message: kind === "avatar" ? "РђРІР°С‚Р°СЂ СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅ." : "РћР±Р»РѕР¶РєР° СѓСЃРїРµС€РЅРѕ Р·Р°РіСЂСѓР¶РµРЅР°.",
      });
      setSettingsMessage(kind === "avatar" ? "РђРІР°С‚Р°СЂ РѕР±РЅРѕРІР»С‘РЅ." : "РћР±Р»РѕР¶РєР° РѕР±РЅРѕРІР»РµРЅР°.");
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
      setSettingsMessage("РСЃС‚РѕСЂРёСЏ РѕРїСѓР±Р»РёРєРѕРІР°РЅР°.");
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
      setSettingsMessage("Р—Р°СЏРІРєР° РІ РґСЂСѓР·СЊСЏ РѕС‚РїСЂР°РІР»РµРЅР°.");
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
      setSettingsMessage("РЎРµРєСЂРµС‚ СЃРѕР·РґР°РЅ. Р’РІРµРґРёС‚Рµ РєРѕРґ РёР· РїСЂРёР»РѕР¶РµРЅРёСЏ-Р°СѓС‚РµРЅС‚РёС„РёРєР°С‚РѕСЂР°.");
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
      setSettingsMessage("2FA СѓСЃРїРµС€РЅРѕ РІРєР»СЋС‡РµРЅР°.");
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
      setSettingsMessage("2FA РѕС‚РєР»СЋС‡РµРЅР°.");
      await loadSettingsData(api, session, setSessionInfo, setDeviceList, setSecurityEvents);
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const revokeDevice = async (deviceId: string) => {
    if (!api || !session) return;
    try {
      await api.revokeDevice(session.accessToken, deviceId);
      setSettingsMessage("РЈСЃС‚СЂРѕР№СЃС‚РІРѕ РѕС‚РѕР·РІР°РЅРѕ.");
      await loadSettingsData(api, session, setSessionInfo, setDeviceList, setSecurityEvents);
    } catch (error) {
      setSettingsMessage(toUserError(error));
    }
  };

  const testConnection = async () => {
    if (!api || !server) return;
    try {
      await fetch(buildServerConfigEndpoint(server.config.apiBaseUrl), { method: "GET" });
      setSettingsMessage("РЎРѕРµРґРёРЅРµРЅРёРµ СЃ СЃРµСЂРІРµСЂРѕРј СѓСЃРїРµС€РЅРѕ.");
    } catch {
      setSettingsMessage("РќРµ СѓРґР°Р»РѕСЃСЊ РїСЂРѕРІРµСЂРёС‚СЊ СЃРѕРµРґРёРЅРµРЅРёРµ СЃ СЃРµСЂРІРµСЂРѕРј.");
    }
  };

  const setBrowserNotificationsPreference = async (enabled: boolean) => {
    setPreferBrowserNotifications(enabled);
    try {
      localStorage.setItem(browserNotificationsPrefKey, enabled ? "enabled" : "disabled");
    } catch {
      // noop
    }

    if (!enabled) {
      setSettingsMessage("Р‘СЂР°СѓР·РµСЂРЅС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ РѕС‚РєР»СЋС‡РµРЅС‹. In-app СѓРІРµРґРѕРјР»РµРЅРёСЏ РїСЂРѕРґРѕР»Р¶Р°СЋС‚ СЂР°Р±РѕС‚Р°С‚СЊ.");
      return;
    }
    if (typeof window === "undefined" || !("Notification" in window)) {
      setSettingsMessage("Р‘СЂР°СѓР·РµСЂРЅС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ РЅРµРґРѕСЃС‚СѓРїРЅС‹ РІ С‚РµРєСѓС‰РµРј РѕРєСЂСѓР¶РµРЅРёРё.");
      return;
    }
    if (Notification.permission === "granted") {
      setBrowserNotificationPermission("granted");
      setSettingsMessage("Р‘СЂР°СѓР·РµСЂРЅС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ РІРєР»СЋС‡РµРЅС‹.");
      return;
    }

    const permission = await Notification.requestPermission();
    setBrowserNotificationPermission(permission);
    if (permission === "granted") {
      setSettingsMessage("Р‘СЂР°СѓР·РµСЂРЅС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ РІРєР»СЋС‡РµРЅС‹.");
      return;
    }
    setPreferBrowserNotifications(false);
    try {
      localStorage.setItem(browserNotificationsPrefKey, "disabled");
    } catch {
      // noop
    }
    setSettingsMessage("Р Р°Р·СЂРµС€РµРЅРёРµ РЅР° Р±СЂР°СѓР·РµСЂРЅС‹Рµ СѓРІРµРґРѕРјР»РµРЅРёСЏ РЅРµ РІС‹РґР°РЅРѕ.");
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
    clearAttachmentPreviews();
    clearAttachmentSecretsCache();
    setNotifications([]);
    setNotificationsUnreadTotal(0);
    setNotificationsError("");
    setNotificationsLoading(false);
    knownNotificationIDsRef.current = new Set();
    shownToastNotificationIDsRef.current = new Set();
    readReceiptInFlightRef.current = new Set();
    setSummaries([]);
    setMyProfile(null);
    setProfileTarget(null);
    setProfilePosts([]);
    setFriends([]);
    setIncomingRequests([]);
    setOutgoingRequests([]);
    setPrivacy(null);
    setStories([]);
    setShowMobileConversationList(true);
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
    return <StandaloneCard title="Р—Р°РїСѓСЃРє РїСЂРёР»РѕР¶РµРЅРёСЏ" subtitle="РџСЂРѕРІРµСЂСЏРµРј СЃРµСЂРІРµСЂ Рё СЃРµСЃСЃРёСЋ..." />;
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
    <div className="min-h-screen pb-[calc(88px+env(safe-area-inset-bottom))] lg:pb-0" style={{ backgroundColor: "var(--core-background)" }}>
      <div className="mx-auto max-w-[1440px] px-3 lg:px-5 py-3 lg:py-5 lg:grid lg:grid-cols-[280px_1fr] gap-5 overflow-x-hidden">
        <div className="hidden lg:block">
          <Sidebar
            activeSection={section}
            onChange={setSection}
            badges={{ notifications: notificationsUnreadTotal, messages: unreadTotal }}
          />
        </div>

        <main key={section} className="space-y-3 lg:space-y-4 app-route-transition">
          <header className="flex items-center justify-between rounded-2xl border px-4 py-3" style={cardStyle}>
            <div>
              <h1 style={{ color: "var(--text-primary)", fontSize: 26, fontWeight: 600 }}>{sectionTitle(section)}</h1>
              <p style={{ color: "var(--base-grey-light)", fontSize: 14 }}>{sectionSubtitle(section, server.input, transportState)}</p>
            </div>
            <StatusChip state={transportState.status} />
          </header>

          {runtimeError ? (
            <div className="space-y-2">
              <InlineInfo tone="warning" text={runtimeError} />
              <button
                type="button"
                data-testid="runtime-reconnect-button"
                className="px-3 py-1.5 rounded-lg border text-sm"
                style={outlineButtonStyle}
                onClick={() => {
                  setRuntimeError("");
                  runtimeRef.current?.requestReconnect();
                }}
              >
                РџРµСЂРµРїРѕРґРєР»СЋС‡РёС‚СЊСЃСЏ
              </button>
            </div>
          ) : null}
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
              onBackToList={() => {
                setShowMobileConversationList(true);
              }}
              showConversationListOnMobile={showMobileConversationList}
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
              onEditMessage={(messageId, nextText) => editMessage(messageId, nextText)}
              onEnsureAttachmentPreview={(attachment) => {
                void ensureAttachmentPreview(attachment);
              }}
              attachmentPreviewState={attachmentPreviews}
              onDownloadAttachment={downloadAttachment}
              onLoadOlderMessages={() => {
                if (!activeConversationId) return;
                void loadOlderMessages(activeConversationId);
              }}
              attachmentOps={attachmentOps}
              transportState={transportState}
              serverInput={server.input}
              onReconnect={() => {
                setRuntimeError("");
                runtimeRef.current?.requestReconnect();
              }}
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
            <NotificationsSection
              notifications={notifications}
              unreadTotal={notificationsUnreadTotal}
              loading={notificationsLoading}
              error={notificationsError}
              renderTitle={renderNotificationTitle}
              onRefresh={() => {
                void refreshNotifications();
              }}
              onOpen={(item) => {
                void openNotification(item);
              }}
              onMarkRead={async (id) => {
                await markNotificationsRead([id], false);
              }}
              onMarkAllRead={async () => {
                await markNotificationsRead([], true);
              }}
              onClearAll={async () => {
                await clearAllNotifications();
              }}
            />
          ) : null}

{section === "profile" ? (
            <section key={profileTarget?.accountId ? `profile-${profileTarget.accountId as string}` : "profile-self"} className="space-y-4 app-section-transition">
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
                        alt="РћР±Р»РѕР¶РєР° РїСЂРѕС„РёР»СЏ"
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
                      alt="РђРІР°С‚Р°СЂ РїСЂРѕС„РёР»СЏ"
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
                        РњРѕР№ РїСЂРѕС„РёР»СЊ
                      </button>
                      {profileTarget.existingDirectConversationId ? (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border text-sm"
                          style={outlineButtonStyle}
                          onClick={() => {
                            setSection("messages");
                            setShowMobileConversationList(false);
                            void openConversation(profileTarget.existingDirectConversationId as string);
                          }}
                        >
                          РћС‚РєСЂС‹С‚СЊ С‡Р°С‚
                        </button>
                      ) : profileTarget.canStartDirectChat ? (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border text-sm"
                          style={outlineButtonStyle}
                          onClick={() => void createDirect(profileTarget.accountId as string)}
                        >
                          <MessageSquare className="w-4 h-4 inline mr-2" />
                          РќР°РїРёСЃР°С‚СЊ
                        </button>
                      ) : null}
                      {profileTarget.friendState === "none" && profileTarget.canSendFriendRequest ? (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border text-sm"
                          style={outlineButtonStyle}
                          onClick={() => void sendFriendRequest(profileTarget.accountId as string)}
                        >
                          Р”РѕР±Р°РІРёС‚СЊ РІ РґСЂСѓР·СЊСЏ
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
                          РџСЂРёРЅСЏС‚СЊ Р·Р°СЏРІРєСѓ
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
                          РћС‚РјРµРЅРёС‚СЊ Р·Р°СЏРІРєСѓ
                        </button>
                      ) : null}
                      {profileTarget.friendState === "friends" ? (
                        <button
                          type="button"
                          className="px-3 py-1.5 rounded-lg border text-sm"
                          style={outlineButtonStyle}
                          onClick={() => void removeFriend(profileTarget.accountId as string)}
                        >
                          РЈРґР°Р»РёС‚СЊ РёР· РґСЂСѓР·РµР№
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
                  <div className="rounded-2xl border p-4 space-y-3 interactive-surface" style={cardStyle}>
                    <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Р РµРґР°РєС‚РёСЂРѕРІР°РЅРёРµ РїСЂРѕС„РёР»СЏ</p>
                    <div className="grid gap-3 md:grid-cols-2">
                      <input value={profileEdit.displayName} onChange={(event) => setProfileEdit((prev) => ({ ...prev, displayName: event.target.value }))} placeholder="РћС‚РѕР±СЂР°Р¶Р°РµРјРѕРµ РёРјСЏ" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <input value={profileEdit.username} onChange={(event) => setProfileEdit((prev) => ({ ...prev, username: event.target.value }))} placeholder="@username" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <input value={profileEdit.statusText} onChange={(event) => setProfileEdit((prev) => ({ ...prev, statusText: event.target.value }))} placeholder="РЎС‚Р°С‚СѓСЃ" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <input value={profileEdit.location} onChange={(event) => setProfileEdit((prev) => ({ ...prev, location: event.target.value }))} placeholder="Р›РѕРєР°С†РёСЏ" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                      <input value={profileEdit.websiteUrl} onChange={(event) => setProfileEdit((prev) => ({ ...prev, websiteUrl: event.target.value }))} placeholder="РЎР°Р№С‚" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }} />
                    </div>
                    <textarea value={profileEdit.bio} onChange={(event) => setProfileEdit((prev) => ({ ...prev, bio: event.target.value }))} placeholder="Рћ СЃРµР±Рµ" className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none resize-none" style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)", minHeight: 90 }} />
                    <div className="flex gap-2 flex-wrap">
                      <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={() => void saveProfile()}>
                        РЎРѕС…СЂР°РЅРёС‚СЊ РїСЂРѕС„РёР»СЊ
                      </button>
                      <label className="px-3 py-2 rounded-lg border cursor-pointer interactive-surface-subtle" style={outlineButtonStyle}>
                        Р—Р°РіСЂСѓР·РёС‚СЊ Р°РІР°С‚Р°СЂ
                        <input type="file" className="hidden" accept="image/*" onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadProfileMedia(file, "avatar");
                          event.currentTarget.value = "";
                        }} />
                      </label>
                      <label className="px-3 py-2 rounded-lg border cursor-pointer interactive-surface-subtle" style={outlineButtonStyle}>
                        Р—Р°РіСЂСѓР·РёС‚СЊ РѕР±Р»РѕР¶РєСѓ
                        <input type="file" className="hidden" accept="image/*" onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadProfileMedia(file, "banner");
                          event.currentTarget.value = "";
                        }} />
                      </label>
                    </div>
                    <div className="grid gap-2 md:grid-cols-2">
                      <UploadStatusPill label="РђРІР°С‚Р°СЂ" status={profileMediaUpload.avatar} />
                      <UploadStatusPill label="РћР±Р»РѕР¶РєР°" status={profileMediaUpload.banner} />
                    </div>
                  </div>

                  <div className="rounded-2xl border p-4 space-y-3 interactive-surface" style={cardStyle}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <input
                        value={storyCaption}
                        onChange={(event) => setStoryCaption(event.target.value)}
                        placeholder="РџРѕРґРїРёСЃСЊ Рє РёСЃС‚РѕСЂРёРё"
                        className="flex-1 min-w-[220px] rounded-lg border bg-transparent px-3 py-2 outline-none"
                        style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
                      />
                      <label className="px-3 py-2 rounded-lg border cursor-pointer interactive-surface-subtle" style={outlineButtonStyle}>
                        Р”РѕР±Р°РІРёС‚СЊ РёСЃС‚РѕСЂРёСЋ
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
                      title="РСЃС‚РѕСЂРёРё"
                      subtitle="РџСѓР±Р»РёРєР°С†РёРё, РєРѕС‚РѕСЂС‹Рµ РёСЃС‡РµР·Р°СЋС‚ С‡РµСЂРµР· 24 С‡Р°СЃР°"
                      stories={stories.slice(0, 8)}
                      loading={false}
                      error=""
                      emptyText="РСЃС‚РѕСЂРёР№ РїРѕРєР° РЅРµС‚."
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

                  <div className="rounded-2xl border p-4 space-y-3 interactive-surface" style={cardStyle}>
                    <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Р”СЂСѓР·СЊСЏ Рё Р·Р°СЏРІРєРё</p>
                    <div className="grid gap-4 md:grid-cols-3">
                      <div>
                        <p style={{ color: "var(--base-grey-light)", fontSize: 12, marginBottom: 8 }}>Р”СЂСѓР·СЊСЏ</p>
                        <div className="space-y-2">
                          {friends.length === 0 ? <InlineInfo text="РЎРїРёСЃРѕРє РґСЂСѓР·РµР№ РїСѓСЃС‚." /> : friends.map((friend) => (
                            <div key={friend.accountId as string} className="rounded-lg border p-2 interactive-surface-subtle" style={innerCardStyle}>
                              <p style={{ color: "var(--text-primary)" }}>{friend.displayName || friend.username}</p>
                              <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>@{friend.username}</p>
                              <div className="mt-2 flex gap-2">
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void createDirect(friend.accountId as string)}>РќР°РїРёСЃР°С‚СЊ</button>
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void openUserProfile(friend.accountId as string)}>РџСЂРѕС„РёР»СЊ</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p style={{ color: "var(--base-grey-light)", fontSize: 12, marginBottom: 8 }}>Р’С…РѕРґСЏС‰РёРµ</p>
                        <div className="space-y-2">
                          {incomingRequests.length === 0 ? <InlineInfo text="РќРµС‚ РІС…РѕРґСЏС‰РёС… Р·Р°СЏРІРѕРє." /> : incomingRequests.map((request) => (
                            <div key={request.id as string} className="rounded-lg border p-2 interactive-surface-subtle" style={innerCardStyle}>
                              <p style={{ color: "var(--text-primary)" }}>{request.actor.displayName || request.actor.username}</p>
                              <div className="mt-2 flex gap-2">
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void processFriendRequest(request.id as string, "accept")}>РџСЂРёРЅСЏС‚СЊ</button>
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void processFriendRequest(request.id as string, "reject")}>РћС‚РєР»РѕРЅРёС‚СЊ</button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div>
                        <p style={{ color: "var(--base-grey-light)", fontSize: 12, marginBottom: 8 }}>РСЃС…РѕРґСЏС‰РёРµ</p>
                        <div className="space-y-2">
                          {outgoingRequests.length === 0 ? <InlineInfo text="РќРµС‚ РёСЃС…РѕРґСЏС‰РёС… Р·Р°СЏРІРѕРє." /> : outgoingRequests.map((request) => (
                            <div key={request.id as string} className="rounded-lg border p-2 interactive-surface-subtle" style={innerCardStyle}>
                              <p style={{ color: "var(--text-primary)" }}>{request.target.displayName || request.target.username}</p>
                              <div className="mt-2 flex gap-2">
                                <button type="button" className="px-2 py-1 rounded-lg border text-xs" style={outlineButtonStyle} onClick={() => void processFriendRequest(request.id as string, "cancel")}>РћС‚РјРµРЅРёС‚СЊ</button>
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
                  title={profileTarget ? "РџСѓР±Р»РёРєР°С†РёРё РїРѕР»СЊР·РѕРІР°С‚РµР»СЏ" : "РњРѕРё РїСѓР±Р»РёРєР°С†РёРё"}
                />
              ) : (
                <InlineInfo text="РџСѓР±Р»РёРєР°С†РёРё СЌС‚РѕРіРѕ РїСЂРѕС„РёР»СЏ СЃРєСЂС‹С‚С‹ РЅР°СЃС‚СЂРѕР№РєР°РјРё РїСЂРёРІР°С‚РЅРѕСЃС‚Рё." />
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
                    setSettingsMessage("РќР°СЃС‚СЂРѕР№РєРё РїСЂРёРІР°С‚РЅРѕСЃС‚Рё СЃРѕС…СЂР°РЅРµРЅС‹.");
                  } catch (error) {
                    setSettingsMessage(toUserError(error));
                  }
                })();
              }}
              serverInput={server.input}
              onTestConnection={() => {
                void testConnection();
              }}
              browserNotificationsEnabled={preferBrowserNotifications}
              browserNotificationsPermission={browserNotificationPermission}
              onBrowserNotificationsChange={(enabled) => {
                void setBrowserNotificationsPreference(enabled);
              }}
              onResetServer={() => {
                void resetServer();
              }}
            />
          ) : null}

        </main>
      </div>
      <BottomNav
        activeSection={section}
        onChange={(nextSection) => {
          setSection(nextSection);
          if (nextSection === "messages") {
            setShowMobileConversationList(true);
          }
        }}
        badges={{ notifications: notificationsUnreadTotal, messages: unreadTotal }}
      />
      <Toaster
        position="top-right"
        theme="dark"
        toastOptions={{
          style: {
            background: "rgba(24,24,24,0.96)",
            color: "var(--text-primary)",
            border: "1px solid var(--glass-border)",
          },
        }}
      />
    </div>
  );
}

export default App;

