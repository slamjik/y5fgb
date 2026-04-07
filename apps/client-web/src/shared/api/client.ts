import type {
  AttachmentDownloadResponse,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  AuthSessionResponse,
  ConversationDetailsResponse,
  CreateConversationResponse,
  CreateGroupConversationRequest,
  CreateSocialPostRequest,
  CreateSocialPostResponse,
  DeviceListResponse,
  ListConversationSummariesResponse,
  ListConversationsResponse,
  ListSocialPostsResponse,
  LoginSuccessResponse,
  LoginTwoFactorRequiredResponse,
  MessageDTO,
  SecurityEventsResponse,
  SendMessageRequest,
  SendMessageResponse,
  SocialNotificationsResponse,
  SocialPostLikeResponse,
  SyncBootstrapResponse,
  SyncPollResponse,
  TwoFactorSetupConfirmResponse,
  TwoFactorSetupStartResponse,
  TransportEndpointsResponse,
  UserPublicProfileResponse,
  UserSearchResponse,
  WebLoginRequest,
  WebRefreshRequest,
  WebRegisterRequest,
  WebTwoFactorLoginVerifyRequest,
} from "@project/protocol";
import type { ServerBootstrapConfig } from "@project/client-core";

export type WebDevicePayload = NonNullable<WebLoginRequest["device"]>;

type HTTPMethod = "GET" | "POST" | "DELETE";

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

const DEFAULT_REQUEST_TIMEOUT_MS = 12000;
const LONG_POLL_GRACE_MS = 8000;
const ATTACHMENT_TIMEOUT_MS = 120000;

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
    device: WebDevicePayload;
    sessionPersistence: "ephemeral" | "remembered";
  }): Promise<LoginSuccessResponse> {
    const body: WebTwoFactorLoginVerifyRequest = {
      challengeId: input.challengeId,
      loginToken: input.loginToken,
      code: input.code,
      device: input.device,
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
    return this.request<AttachmentUploadResponse>("/attachments/upload", "POST", body, accessToken, ATTACHMENT_TIMEOUT_MS);
  }

  async downloadAttachment(accessToken: string, attachmentId: string): Promise<AttachmentDownloadResponse> {
    return this.request<AttachmentDownloadResponse>(
      `/attachments/${attachmentId}/download`,
      "GET",
      undefined,
      accessToken,
      ATTACHMENT_TIMEOUT_MS,
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

  async getUserProfile(accessToken: string, accountId: string): Promise<UserPublicProfileResponse> {
    return this.request<UserPublicProfileResponse>(`/users/${accountId}/profile`, "GET", undefined, accessToken);
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
          : error instanceof Error
            ? error.message
            : "network error";
      throw new ApiClientError(message, 0, "network_error");
    } finally {
      clearTimeout(timeoutHandle);
    }

    const payload = await response.json().catch(() => ({}));
    return { response, payload };
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


