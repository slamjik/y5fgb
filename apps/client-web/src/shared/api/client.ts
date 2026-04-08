import type {
  AttachmentDownloadResponse,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  AuthSessionResponse,
  ConversationDetailsResponse,
  CreateFriendRequestBody,
  CreateConversationResponse,
  CreateGroupConversationRequest,
  CreateSocialPostRequest,
  CreateSocialPostResponse,
  CreateStoryRequest,
  DeviceListResponse,
  FriendListResponse,
  FriendRequestActionResponse,
  FriendRequestsResponse,
  ListConversationSummariesResponse,
  ListConversationsResponse,
  ListSocialPostsResponse,
  LoginSuccessResponse,
  LoginTwoFactorRequiredResponse,
  MediaMetadataResponse,
  MediaUploadResponse,
  MessageDTO,
  NotificationsResponse,
  PrivacyResponse,
  PrivacyUpdateRequest,
  ProfileResponse,
  ProfileDTO,
  ProfileSearchResponse,
  SecurityEventsResponse,
  SendMessageRequest,
  SendMessageResponse,
  SocialNotificationsResponse,
  SocialPostLikeResponse,
  StoryFeedResponse,
  StoryResponse,
  SyncBootstrapResponse,
  SyncPollResponse,
  TwoFactorSetupConfirmResponse,
  TwoFactorSetupStartResponse,
  TransportEndpointsResponse,
  UserSearchResponse,
  WebLoginRequest,
  WebRefreshRequest,
  WebRegisterRequest,
  WebTwoFactorLoginVerifyRequest,
} from "@project/protocol";
import type { ServerBootstrapConfig } from "@project/client-core";
import type { MediaID, StoryID } from "@project/shared-types";

export type WebDevicePayload = NonNullable<WebLoginRequest["device"]>;

type HTTPMethod = "GET" | "POST" | "PATCH" | "DELETE";

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const LONG_POLL_GRACE_MS = 8000;
const LARGE_TRANSFER_TIMEOUT_MS = 300000;

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, status = 0, code = "network_error") {
    super(message);
    this.code = code;
    this.status = status;
  }
}

export class WebApiClient {
  constructor(private readonly config: ServerBootstrapConfig) {}

  async registerWeb(input: {
    email: string;
    password: string;
    device: WebDevicePayload;
    sessionPersistence: "ephemeral" | "remembered";
  }): Promise<LoginSuccessResponse> {
    const body: WebRegisterRequest = {
      email: input.email,
      password: input.password,
      device: input.device,
      sessionPersistence: input.sessionPersistence,
    };
    return this.request<LoginSuccessResponse>("/auth/web/register", "POST", body);
  }

  async loginWeb(input: {
    email: string;
    password: string;
    device: WebDevicePayload;
    sessionPersistence: "ephemeral" | "remembered";
  }): Promise<LoginSuccessResponse | LoginTwoFactorRequiredResponse> {
    const body: WebLoginRequest = {
      email: input.email,
      password: input.password,
      device: input.device,
      sessionPersistence: input.sessionPersistence,
    };

    const { response, payload } = await this.requestRaw("/auth/web/login", "POST", body);
    if (response.ok) {
      return payload as LoginSuccessResponse;
    }

    if (
      response.status === 401 &&
      payload &&
      typeof payload === "object" &&
      typeof (payload as Record<string, unknown>).challengeId === "string" &&
      typeof (payload as Record<string, unknown>).loginToken === "string" &&
      typeof (payload as Record<string, unknown>).expiresAt === "string"
    ) {
      const challenge = payload as Record<string, string>;
      return {
        challengeId: challenge.challengeId,
        loginToken: challenge.loginToken,
        expiresAt: challenge.expiresAt as LoginTwoFactorRequiredResponse["expiresAt"],
      };
    }

    throw this.errorFromPayload(payload, response.status, "Ошибка входа.");
  }

  async verifyWeb2FA(input: {
    challengeId: string;
    loginToken: string;
    code: string;
    device?: Partial<WebDevicePayload>;
    sessionPersistence: "ephemeral" | "remembered";
  }): Promise<LoginSuccessResponse> {
    const body: WebTwoFactorLoginVerifyRequest = {
      challengeId: input.challengeId,
      loginToken: input.loginToken,
      code: input.code,
      ...(input.device ? { device: input.device } : {}),
      sessionPersistence: input.sessionPersistence,
    };
    return this.request<LoginSuccessResponse>("/auth/web/2fa/verify", "POST", body);
  }

  async refreshWeb(refreshToken: string): Promise<LoginSuccessResponse> {
    const body: WebRefreshRequest = { refreshToken };
    return this.request<LoginSuccessResponse>("/auth/web/refresh", "POST", body);
  }

  async webSession(accessToken: string): Promise<AuthSessionResponse> {
    return this.request<AuthSessionResponse>("/auth/web/session", "GET", undefined, accessToken);
  }

  async webLogout(accessToken: string, refreshToken?: string): Promise<void> {
    await this.request("/auth/web/logout", "POST", refreshToken ? { refreshToken } : undefined, accessToken);
  }

  async webLogoutAll(accessToken: string): Promise<void> {
    await this.request("/auth/web/logout-all", "POST", undefined, accessToken);
  }

  async listConversationSummaries(
    accessToken: string,
    input: { limit?: number; offset?: number } = {},
  ): Promise<ListConversationSummariesResponse> {
    const params = new URLSearchParams();
    if (typeof input.limit === "number") {
      params.set("limit", String(input.limit));
    }
    if (typeof input.offset === "number") {
      params.set("offset", String(input.offset));
    }
    const query = params.toString();
    return this.request<ListConversationSummariesResponse>(
      `/conversations/summaries${query ? `?${query}` : ""}`,
      "GET",
      undefined,
      accessToken,
    );
  }

  async listConversations(accessToken: string): Promise<ListConversationsResponse> {
    return this.request<ListConversationsResponse>("/conversations", "GET", undefined, accessToken);
  }

  async getConversation(accessToken: string, conversationId: string): Promise<ConversationDetailsResponse> {
    return this.request<ConversationDetailsResponse>(`/conversations/${conversationId}`, "GET", undefined, accessToken);
  }

  async listConversationMessages(
    accessToken: string,
    conversationId: string,
    input: { limit?: number; beforeSequence?: number } = {},
  ) {
    const params = new URLSearchParams();
    if (typeof input.limit === "number") {
      params.set("limit", String(input.limit));
    }
    if (typeof input.beforeSequence === "number" && input.beforeSequence > 0) {
      params.set("beforeSequence", String(input.beforeSequence));
    }
    const query = params.toString();
    return this.request<{
      conversationId: string;
      messages: MessageDTO[];
      nextCursor: number;
    }>(`/conversations/${conversationId}/messages${query ? `?${query}` : ""}`, "GET", undefined, accessToken);
  }

  async createDirectConversation(accessToken: string, peerAccountId: string): Promise<CreateConversationResponse> {
    return this.request<CreateConversationResponse>(
      "/conversations/direct",
      "POST",
      { peerAccountId },
      accessToken,
    );
  }

  async createGroupConversation(
    accessToken: string,
    body: CreateGroupConversationRequest,
  ): Promise<CreateConversationResponse> {
    return this.request<CreateConversationResponse>("/conversations/group", "POST", body, accessToken);
  }

  async sendMessage(
    accessToken: string,
    conversationId: string,
    body: SendMessageRequest,
  ): Promise<SendMessageResponse> {
    return this.request<SendMessageResponse>(`/conversations/${conversationId}/messages`, "POST", body, accessToken);
  }

  async createReceipt(accessToken: string, messageId: string, receiptType: "delivered" | "read"): Promise<void> {
    await this.request(`/messages/${messageId}/receipts`, "POST", { receiptType }, accessToken);
  }

  async syncBootstrap(accessToken: string, limit = 100): Promise<SyncBootstrapResponse> {
    return this.request<SyncBootstrapResponse>(`/sync/bootstrap?limit=${limit}`, "GET", undefined, accessToken);
  }

  async syncPoll(
    accessToken: string,
    input: { cursor?: number; timeoutSec?: number; limit?: number },
  ): Promise<SyncPollResponse> {
    const params = new URLSearchParams();
    if (typeof input.cursor === "number") {
      params.set("cursor", String(Math.max(0, Math.floor(input.cursor))));
    }
    if (typeof input.timeoutSec === "number") {
      params.set("timeoutSec", String(Math.max(1, Math.floor(input.timeoutSec))));
    }
    if (typeof input.limit === "number") {
      params.set("limit", String(Math.max(1, Math.floor(input.limit))));
    }
    const pollTimeoutSec = typeof input.timeoutSec === "number" ? Math.max(1, Math.floor(input.timeoutSec)) : 25;
    return this.request<SyncPollResponse>(
      `/sync/poll?${params.toString()}`,
      "GET",
      undefined,
      accessToken,
      pollTimeoutSec * 1000 + LONG_POLL_GRACE_MS,
    );
  }

  async transportEndpoints(accessToken: string): Promise<TransportEndpointsResponse> {
    return this.request<TransportEndpointsResponse>("/transport/endpoints", "GET", undefined, accessToken);
  }

  async uploadAttachment(accessToken: string, body: AttachmentUploadRequest): Promise<AttachmentUploadResponse> {
    return this.request<AttachmentUploadResponse>("/attachments/upload", "POST", body, accessToken, LARGE_TRANSFER_TIMEOUT_MS);
  }

  async downloadAttachment(accessToken: string, attachmentId: string): Promise<AttachmentDownloadResponse> {
    return this.request<AttachmentDownloadResponse>(
      `/attachments/${attachmentId}/download`,
      "GET",
      undefined,
      accessToken,
      LARGE_TRANSFER_TIMEOUT_MS,
    );
  }

  async listPosts(
    accessToken: string,
    input: { query?: string; mediaType?: "image" | "video" | "all"; scope?: "mine"; limit?: number } = {},
  ): Promise<ListSocialPostsResponse> {
    const params = new URLSearchParams();
    params.set("limit", String(input.limit ?? 30));
    if (input.query) {
      params.set("query", input.query);
    }
    if (input.mediaType && input.mediaType !== "all") {
      params.set("mediaType", input.mediaType);
    }
    if (input.scope === "mine") {
      params.set("scope", "mine");
    }
    return this.request<ListSocialPostsResponse>(`/social/posts?${params.toString()}`, "GET", undefined, accessToken);
  }

  async createPost(accessToken: string, body: CreateSocialPostRequest): Promise<CreateSocialPostResponse> {
    return this.request<CreateSocialPostResponse>("/social/posts", "POST", body, accessToken);
  }

  async deletePost(accessToken: string, postId: string): Promise<void> {
    await this.request(`/social/posts/${postId}`, "DELETE", undefined, accessToken);
  }

  async togglePostLike(accessToken: string, postId: string, currentlyLiked: boolean): Promise<SocialPostLikeResponse> {
    return this.request<SocialPostLikeResponse>(
      `/social/posts/${postId}/like`,
      currentlyLiked ? "DELETE" : "POST",
      undefined,
      accessToken,
    );
  }

  async socialNotifications(accessToken: string, limit = 20): Promise<SocialNotificationsResponse> {
    return this.request<SocialNotificationsResponse>(`/social/notifications?limit=${limit}`, "GET", undefined, accessToken);
  }

  async searchUsers(accessToken: string, query: string, limit = 20): Promise<UserSearchResponse> {
    const params = new URLSearchParams({ query, limit: String(limit) });
    return this.request<UserSearchResponse>(`/users/search?${params.toString()}`, "GET", undefined, accessToken);
  }

  async getUserProfile(accessToken: string, accountId: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(`/profiles/${accountId}`, "GET", undefined, accessToken);
  }

  async getMyProfile(accessToken: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>("/profiles/me", "GET", undefined, accessToken);
  }

  async updateMyProfile(accessToken: string, patch: {
    displayName?: string | null;
    username?: string | null;
    bio?: string | null;
    statusText?: string | null;
    birthDate?: string | null;
    location?: string | null;
    websiteUrl?: string | null;
    avatarMediaId?: MediaID | null;
    bannerMediaId?: MediaID | null;
  }): Promise<ProfileResponse> {
    return this.request<ProfileResponse>("/profiles/me", "PATCH", patch, accessToken);
  }

  async getProfileByUsername(accessToken: string, username: string): Promise<ProfileResponse> {
    return this.request<ProfileResponse>(
      `/profiles/by-username/${encodeURIComponent(username)}`,
      "GET",
      undefined,
      accessToken,
    );
  }

  async searchProfiles(accessToken: string, query: string, limit = 20): Promise<ProfileSearchResponse> {
    const params = new URLSearchParams({ query, limit: String(limit) });
    const response = await this.request<Partial<ProfileSearchResponse> & { users?: unknown[] }>(
      `/profiles/search?${params.toString()}`,
      "GET",
      undefined,
      accessToken,
    );
    if (Array.isArray(response.profiles)) {
      return {
        profiles: response.profiles,
        total: typeof response.total === "number" ? response.total : response.profiles.length,
      };
    }
    // Backward-compatible fallback for older server payloads.
    if (Array.isArray(response.users)) {
      const legacyProfiles = response.users
        .map((item) => mapLegacyUserToProfile(item))
        .filter((item): item is ProfileDTO => item !== null);
      return {
        profiles: legacyProfiles,
        total: legacyProfiles.length,
      };
    }
    return { profiles: [], total: 0 };
  }

  async getPrivacy(accessToken: string): Promise<PrivacyResponse> {
    return this.request<PrivacyResponse>("/privacy/me", "GET", undefined, accessToken);
  }

  async updatePrivacy(accessToken: string, patch: PrivacyUpdateRequest): Promise<PrivacyResponse> {
    return this.request<PrivacyResponse>("/privacy/me", "PATCH", patch, accessToken);
  }

  async listFriends(accessToken: string, limit = 100): Promise<FriendListResponse> {
    return this.request<FriendListResponse>(`/friends?limit=${Math.max(1, limit)}`, "GET", undefined, accessToken);
  }

  async listFriendRequests(
    accessToken: string,
    direction: "incoming" | "outgoing",
    limit = 100,
  ): Promise<FriendRequestsResponse> {
    const params = new URLSearchParams({ direction, limit: String(Math.max(1, limit)) });
    return this.request<FriendRequestsResponse>(`/friends/requests?${params.toString()}`, "GET", undefined, accessToken);
  }

  async createFriendRequest(accessToken: string, body: CreateFriendRequestBody): Promise<FriendRequestActionResponse> {
    return this.request<FriendRequestActionResponse>("/friends/requests", "POST", body, accessToken);
  }

  async acceptFriendRequest(accessToken: string, requestId: string): Promise<FriendRequestActionResponse> {
    return this.request<FriendRequestActionResponse>(`/friends/requests/${requestId}/accept`, "POST", undefined, accessToken);
  }

  async rejectFriendRequest(accessToken: string, requestId: string): Promise<FriendRequestActionResponse> {
    return this.request<FriendRequestActionResponse>(`/friends/requests/${requestId}/reject`, "POST", undefined, accessToken);
  }

  async cancelFriendRequest(accessToken: string, requestId: string): Promise<FriendRequestActionResponse> {
    return this.request<FriendRequestActionResponse>(`/friends/requests/${requestId}/cancel`, "POST", undefined, accessToken);
  }

  async removeFriend(accessToken: string, accountId: string): Promise<void> {
    await this.request(`/friends/${accountId}`, "DELETE", undefined, accessToken);
  }

  async blockUser(accessToken: string, accountId: string): Promise<void> {
    await this.request(`/friends/${accountId}/block`, "POST", undefined, accessToken);
  }

  async unblockUser(accessToken: string, accountId: string): Promise<void> {
    await this.request(`/friends/${accountId}/block`, "DELETE", undefined, accessToken);
  }

  async uploadMedia(
    accessToken: string,
    input: {
      file: File;
      domain: "profile" | "social" | "story";
      kind: "avatar" | "banner" | "photo" | "video" | "story_image" | "story_video";
      visibility?: "public" | "friends" | "only_me";
    },
  ): Promise<MediaUploadResponse> {
    const form = new FormData();
    form.set("file", input.file, input.file.name);
    form.set("domain", input.domain);
    form.set("kind", input.kind);
    if (input.visibility) {
      form.set("visibility", input.visibility);
    }
    return this.requestForm<MediaUploadResponse>("/media/upload", "POST", form, accessToken, LARGE_TRANSFER_TIMEOUT_MS);
  }

  async getMedia(accessToken: string, mediaId: string): Promise<MediaMetadataResponse> {
    return this.request<MediaMetadataResponse>(`/media/${mediaId}`, "GET", undefined, accessToken);
  }

  async deleteMedia(accessToken: string, mediaId: string): Promise<void> {
    await this.request(`/media/${mediaId}`, "DELETE", undefined, accessToken);
  }

  async createStory(accessToken: string, payload: CreateStoryRequest): Promise<StoryResponse> {
    return this.request<StoryResponse>("/stories", "POST", payload, accessToken);
  }

  async listStoryFeed(accessToken: string, limit = 60): Promise<StoryFeedResponse> {
    return this.request<StoryFeedResponse>(`/stories/feed?limit=${Math.max(1, limit)}`, "GET", undefined, accessToken);
  }

  async getStory(accessToken: string, storyId: StoryID | string): Promise<StoryResponse> {
    return this.request<StoryResponse>(`/stories/${storyId as string}`, "GET", undefined, accessToken);
  }

  async deleteStory(accessToken: string, storyId: StoryID | string): Promise<void> {
    await this.request(`/stories/${storyId as string}`, "DELETE", undefined, accessToken);
  }

  async listNotifications(accessToken: string, limit = 50): Promise<NotificationsResponse> {
    return this.request<NotificationsResponse>(`/notifications?limit=${Math.max(1, limit)}`, "GET", undefined, accessToken);
  }

  async listDevices(accessToken: string): Promise<DeviceListResponse> {
    return this.request<DeviceListResponse>("/devices", "GET", undefined, accessToken);
  }

  async revokeDevice(accessToken: string, deviceId: string, twoFactorCode?: string): Promise<void> {
    await this.request(
      "/devices/revoke",
      "POST",
      { deviceId, ...(twoFactorCode ? { twoFactorCode } : {}) },
      accessToken,
    );
  }

  async listSecurityEvents(accessToken: string, limit = 50): Promise<SecurityEventsResponse> {
    return this.request<SecurityEventsResponse>(`/security-events?limit=${limit}`, "GET", undefined, accessToken);
  }

  async startTwoFA(accessToken: string): Promise<TwoFactorSetupStartResponse> {
    return this.request<TwoFactorSetupStartResponse>("/auth/2fa/setup/start", "POST", {}, accessToken);
  }

  async confirmTwoFA(accessToken: string, code: string): Promise<TwoFactorSetupConfirmResponse> {
    return this.request<TwoFactorSetupConfirmResponse>("/auth/2fa/setup/confirm", "POST", { code }, accessToken);
  }

  async disableTwoFA(accessToken: string, code: string): Promise<void> {
    await this.request("/auth/2fa/disable", "POST", { code }, accessToken);
  }

  private async request<T>(
    path: string,
    method: HTTPMethod,
    body?: unknown,
    accessToken?: string,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const { response, payload } = await this.requestRaw(path, method, body, accessToken, timeoutMs);
    if (!response.ok) {
      throw this.errorFromPayload(payload, response.status, "Ошибка запроса.");
    }
    return payload as T;
  }

  private async requestRaw(
    path: string,
    method: HTTPMethod,
    body?: unknown,
    accessToken?: string,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<{ response: Response; payload: unknown }> {
    const endpoint = `${this.config.apiBaseUrl}${this.config.apiPrefix}${path}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Превышено время ожидания ответа сервера."
          : "Не удалось подключиться к серверу.";
      throw new ApiClientError(message, 0, "network_error");
    } finally {
      clearTimeout(timeoutHandle);
    }

    const payload = await response.json().catch(() => ({}));
    return { response, payload };
  }

  private async requestForm<T>(
    path: string,
    method: HTTPMethod,
    body: FormData,
    accessToken?: string,
    timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ): Promise<T> {
    const endpoint = `${this.config.apiBaseUrl}${this.config.apiPrefix}${path}`;
    const controller = new AbortController();
    const timeoutHandle = setTimeout(() => controller.abort(), Math.max(1000, timeoutMs));
    let response: Response;
    try {
      response = await fetch(endpoint, {
        method,
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body,
      });
    } catch (error) {
      const message =
        error instanceof Error && error.name === "AbortError"
          ? "Превышено время ожидания ответа сервера."
          : "Не удалось подключиться к серверу.";
      throw new ApiClientError(message, 0, "network_error");
    } finally {
      clearTimeout(timeoutHandle);
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw this.errorFromPayload(payload, response.status, "Ошибка загрузки файла.");
    }
    return payload as T;
  }

  private errorFromPayload(payload: unknown, status: number, fallback: string): ApiClientError {
    if (!payload || typeof payload !== "object") {
      return new ApiClientError(fallback, status, "request_failed");
    }
    const source = payload as ApiErrorPayload;
    const message = source.error?.message?.trim() || fallback;
    const code = source.error?.code?.trim() || "request_failed";
    return new ApiClientError(message, status, code);
  }
}

function mapLegacyUserToProfile(input: unknown): ProfileDTO | null {
  if (!input || typeof input !== "object") {
    return null;
  }
  const source = input as Record<string, unknown>;
  const accountId = typeof source.accountId === "string" ? source.accountId : "";
  const username = typeof source.username === "string" ? source.username : "";
  const displayName = typeof source.displayName === "string" ? source.displayName : username || "Пользователь";
  if (!accountId) {
    return null;
  }

  const createdAtRaw = typeof source.createdAt === "string" ? source.createdAt : "";
  const createdAt = createdAtRaw || new Date().toISOString();
  const avatarMediaId = typeof source.avatarMediaId === "string" ? source.avatarMediaId : null;

  return {
    accountId: accountId as ProfileDTO["accountId"],
    displayName,
    username,
    bio: "",
    statusText: "",
    birthDate: null,
    location: null,
    websiteUrl: null,
    avatarMediaId: avatarMediaId as ProfileDTO["avatarMediaId"],
    bannerMediaId: null,
    friendState: "none",
    postCount: 0,
    photoCount: 0,
    friendCount: 0,
    canStartDirectChat: true,
    existingDirectConversationId: null,
    canViewPosts: false,
    canViewPhotos: false,
    canViewStories: false,
    canViewFriends: false,
    canSendFriendRequest: true,
    createdAt: createdAt as ProfileDTO["createdAt"],
    privacy: {
      profileVisibility: "public",
      postsVisibility: "friends",
      photosVisibility: "friends",
      storiesVisibility: "friends",
      friendsVisibility: "friends",
      birthDateVisibility: "friends",
      locationVisibility: "friends",
      linksVisibility: "friends",
      friendRequestsPolicy: "anyone",
      dmPolicy: "friends",
      updatedAt: createdAt as ProfileDTO["createdAt"],
    },
  };
}


