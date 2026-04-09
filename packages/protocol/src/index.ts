import type {
  AccountID,
  ApprovalRequestID,
  AttachmentID,
  ClientPlatform,
  ConversationID,
  DeviceID,
  DeviceRecipientID,
  FriendRequestID,
  ISO8601Timestamp,
  MediaID,
  MessageID,
  PluginCommandID,
  PluginCapability,
  PluginEventID,
  PluginID,
  PluginPanelID,
  PluginStatus,
  PostID,
  ReceiptID,
  RecoveryFlowID,
  SecurityEventID,
  SessionClass,
  SessionPersistenceMode,
  SessionID,
  SyncCursorID,
  StoryID,
  TransportLifecycleEvent,
  TransportLifecycleState,
  TransportEndpointID,
  UserID,
} from "@project/shared-types";

export type ClientEventType =
  | "client.hello"
  | "client.ping"
  | "client.ack"
  | "client.subscribe"
  | "client.unsubscribe"
  | "client.sync.ack";

export type ServerEventType =
  | "server.hello"
  | "server.pong"
  | "server.ack"
  | "server.error"
  | "server.notice"
  | "server.sync_available"
  | "server.transport.status";

export type EventType = ClientEventType | ServerEventType;

export interface MessageEnvelope<TPayload = unknown> {
  id: MessageID;
  type: EventType;
  senderUserId?: UserID;
  senderDeviceId?: DeviceID;
  timestamp: ISO8601Timestamp;
  payload: TPayload;
}

export interface WsClientMessage<TPayload = unknown> {
  direction: "client_to_server";
  envelope: MessageEnvelope<TPayload>;
}

export interface WsServerMessage<TPayload = unknown> {
  direction: "server_to_client";
  envelope: MessageEnvelope<TPayload>;
}

export type WsMessage<TPayload = unknown> = WsClientMessage<TPayload> | WsServerMessage<TPayload>;

export type DeviceStatus = "pending" | "trusted" | "revoked" | "blocked";
export type VerificationState = "unverified" | "verified" | "changed" | "revoked";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "expired";
export type SessionStatus = "active" | "revoked" | "expired";
export type TrustState = "trusted" | "warning" | "revoked" | "unknown";
export type DeliveryState = "pending" | "queued" | "sent" | "delivered" | "failed" | "expired";
export type ConversationType = "direct" | "group";
export type ConversationRole = "owner" | "admin" | "member";
export type ReceiptType = "delivered" | "read";
export type AttachmentKind = "image" | "file";
export type TransportMode = "websocket" | "long_poll";
export type SocialMediaType = "image" | "video";
export type VisibilityScope = "public" | "friends" | "only_me";
export type FriendRequestPolicy = "anyone" | "friends_of_friends" | "nobody";
export type DirectMessagePolicy = "everyone" | "friends" | "nobody";
export type FriendState = "none" | "incoming_request" | "outgoing_request" | "friends" | "blocked";
export type FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";
export type NotificationType = "social_like" | "friend_request" | "friend_accepted" | "story_published";
export type NotificationNavigationTarget = "profile" | "chat" | "post" | "friends_requests";

export type SecurityEventType =
  | "account_registered"
  | "login_success"
  | "login_failed"
  | "two_fa_enabled"
  | "two_fa_disabled"
  | "device_added"
  | "device_pending"
  | "device_approved"
  | "device_rejected"
  | "device_revoked"
  | "device_key_changed"
  | "identity_changed"
  | "recovery_used"
  | "refresh_token_reuse_detected"
  | "message_sent"
  | "message_delivered"
  | "message_failed"
  | "attachment_uploaded"
  | "attachment_downloaded"
  | "transport_switched";

export interface ApiError {
  code:
    | "invalid_credentials"
    | "two_fa_required"
    | "device_not_approved"
    | "forbidden_last_trusted_revoke"
    | "invalid_recovery_token"
    | "account_already_exists"
    | "fingerprint_mismatch"
    | "unauthorized"
    | "forbidden"
    | "validation_error"
    | "not_found"
    | "internal_error"
    | "transport_unavailable"
    | "endpoint_unreachable"
    | "sync_conflict"
    | "conversation_not_found"
    | "membership_denied"
    | "attachment_upload_failed"
    | "attachment_download_failed"
    | "message_encrypt_failed"
    | "message_decrypt_failed"
    | "local_storage_unavailable"
    | "message_expired"
    | "retryable_transport_error"
    | "plugin_manifest_invalid"
    | "plugin_permission_denied"
    | "plugin_runtime_init_failed"
    | "plugin_bridge_violation"
    | "plugin_load_failed"
    | "plugin_disabled"
    | "plugin_storage_unavailable"
    | "session_class_not_allowed"
    | "crypto_unavailable_for_platform";
  message: string;
  details?: Record<string, unknown>;
  request_id: string;
}

export interface ErrorPayload {
  error: ApiError;
}

export interface FingerprintInfo {
  algorithm: "sha256";
  value: string;
  safetyNumber: string;
}

export interface AccountIdentityDTO {
  accountId: AccountID;
  publicIdentityMaterial: string;
  fingerprint: FingerprintInfo;
  verificationState: VerificationState;
  trustState: TrustState;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export interface DeviceDTO {
  id: DeviceID;
  accountId: AccountID;
  name: string;
  platform: string;
  publicDeviceMaterial: string;
  fingerprint: FingerprintInfo;
  status: DeviceStatus;
  verificationState: VerificationState;
  keyInfo: {
    version: number;
    rotatedAt: ISO8601Timestamp | null;
    rotationDueAt: ISO8601Timestamp | null;
    rotationRecommended: boolean;
  };
  createdAt: ISO8601Timestamp;
  lastSeenAt: ISO8601Timestamp | null;
  revokedAt: ISO8601Timestamp | null;
}

export interface DeviceApprovalRequestDTO {
  id: ApprovalRequestID;
  accountId: AccountID;
  deviceId: DeviceID;
  status: ApprovalStatus;
  createdAt: ISO8601Timestamp;
  resolvedAt: ISO8601Timestamp | null;
}

export interface SessionDTO {
  id: SessionID;
  accountId: AccountID;
  deviceId: DeviceID;
  status: SessionStatus;
  clientPlatform?: ClientPlatform;
  sessionClass?: SessionClass;
  persistent?: boolean;
  accessTokenExpiresAt: ISO8601Timestamp;
  refreshTokenExpiresAt: ISO8601Timestamp;
  createdAt: ISO8601Timestamp;
  lastSeenAt: ISO8601Timestamp | null;
  trustWarnings?: string[];
}

export interface SecurityEventDTO {
  id: SecurityEventID;
  accountId: AccountID;
  deviceId: DeviceID | null;
  eventType: SecurityEventType;
  severity: "info" | "warning" | "critical";
  trustState: TrustState;
  metadata: Record<string, unknown>;
  createdAt: ISO8601Timestamp;
}

export interface TokensDTO {
  accessToken: string;
  refreshToken: string;
  tokenType: "Bearer";
  expiresInSeconds: number;
}

export interface RegisterRequest {
  email: string;
  password: string;
  accountIdentityMaterial: string;
  accountIdentityFingerprint?: string;
  device: {
    deviceId?: string;
    name: string;
    platform: string;
    publicDeviceMaterial: string;
    fingerprint?: string;
  };
}

export interface RegisterResponse {
  accountId: AccountID;
  identity: AccountIdentityDTO;
  device: DeviceDTO;
  session: SessionDTO;
  tokens: TokensDTO;
  recoveryCodes: string[];
}

export interface LoginRequest {
  email: string;
  password: string;
  device: {
    deviceId?: string;
    name: string;
    platform: string;
    publicDeviceMaterial: string;
    fingerprint?: string;
  };
}

export interface LoginSuccessResponse {
  accountId: AccountID;
  identity: AccountIdentityDTO;
  device: DeviceDTO;
  session: SessionDTO;
  tokens: TokensDTO;
  recoveryCodes?: string[];
}

export interface LoginTwoFactorRequiredResponse {
  challengeId: string;
  loginToken: string;
  expiresAt: ISO8601Timestamp;
}

export interface LoginPendingApprovalResponse {
  approvalRequestId: ApprovalRequestID;
  approvalPollToken: string;
  status: ApprovalStatus;
}

export interface TwoFactorLoginVerifyRequest {
  challengeId: string;
  loginToken: string;
  code: string;
}

export interface RefreshRequest {
  refreshToken: string;
}

export interface RefreshResponse {
  session: SessionDTO;
  tokens: TokensDTO;
}

export interface LogoutRequest {
  refreshToken?: string;
}

export interface LogoutAllResponse {
  revokedSessions: number;
}

export interface AuthSessionResponse {
  accountId: AccountID;
  email: string;
  twoFactorEnabled: boolean;
  identity: AccountIdentityDTO;
  device: DeviceDTO;
  session: SessionDTO;
}

export interface WebLoginRequest {
  email: string;
  password: string;
  device: {
    deviceId?: string;
    name: string;
    platform: string;
    publicDeviceMaterial: string;
    fingerprint?: string;
  };
  sessionPersistence?: SessionPersistenceMode;
}

export interface WebRegisterRequest {
  email: string;
  password: string;
  device: {
    deviceId?: string;
    name: string;
    platform: string;
    publicDeviceMaterial: string;
    fingerprint?: string;
  };
  sessionPersistence?: SessionPersistenceMode;
}

export interface WebTwoFactorLoginVerifyRequest {
  challengeId: string;
  loginToken: string;
  code: string;
  device?: {
    deviceId?: string;
    name?: string;
    platform?: string;
    publicDeviceMaterial?: string;
    fingerprint?: string;
  };
  sessionPersistence?: SessionPersistenceMode;
}

export interface WebRefreshRequest {
  refreshToken: string;
}

export interface WebLogoutRequest {
  refreshToken?: string;
}

export interface TwoFactorSetupStartResponse {
  secret: string;
  provisioningUri: string;
}

export interface TwoFactorSetupConfirmRequest {
  code: string;
}

export interface TwoFactorSetupConfirmResponse {
  enabled: true;
  recoveryCodes: string[];
}

export interface TwoFactorDisableRequest {
  code: string;
}

export interface DeviceListResponse {
  currentDeviceId: DeviceID;
  devices: DeviceDTO[];
  approvals: DeviceApprovalRequestDTO[];
}

export interface DeviceApproveRequest {
  approvalRequestId: ApprovalRequestID;
  twoFactorCode?: string;
}

export interface DeviceRejectRequest {
  approvalRequestId: ApprovalRequestID;
  twoFactorCode?: string;
}

export interface DeviceRevokeRequest {
  deviceId: DeviceID;
  twoFactorCode?: string;
}

export interface DeviceRotateKeyRequest {
  publicDeviceMaterial: string;
  fingerprint?: string;
  twoFactorCode?: string;
}

export interface DeviceRotateKeyResponse {
  device: DeviceDTO;
}

export interface DeviceApprovalsStatusResponse {
  approvalRequestId: ApprovalRequestID;
  status: ApprovalStatus;
  resolvedAt: ISO8601Timestamp | null;
}

export interface RecoveryStartRequest {
  email: string;
  approvalRequestId: ApprovalRequestID;
}

export interface RecoveryStartResponse {
  recoveryFlowId: RecoveryFlowID;
  recoveryToken: string;
  expiresAt: ISO8601Timestamp;
}

export interface RecoveryCompleteRequest {
  recoveryFlowId: RecoveryFlowID;
  recoveryToken: string;
  recoveryCode: string;
  twoFactorCode?: string;
}

export interface SecurityEventsResponse {
  events: SecurityEventDTO[];
}

export interface DisappearingPolicyDTO {
  defaultTtlSeconds: number;
  allowPerMessageOverride: boolean;
}

export interface ConversationMemberDTO {
  accountId: AccountID;
  role: ConversationRole;
  joinedAt: ISO8601Timestamp;
  isActive: boolean;
  trustedDevices: DeviceDTO[];
}

export interface ConversationDTO {
  id: ConversationID;
  type: ConversationType;
  title: string | null;
  createdByAccountId: AccountID;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  disappearingPolicy: DisappearingPolicyDTO;
  members: ConversationMemberDTO[];
  lastServerSequence: number;
}

export interface EncryptedRecipientKeyDTO {
  recipientDeviceId: DeviceRecipientID;
  wrappedKey: string;
  keyAlgorithm: string;
}

export interface AttachmentMetaDTO {
  id: AttachmentID;
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  encryption: {
    algorithm: string;
    nonce: string;
  };
  createdAt: ISO8601Timestamp;
}

export interface MessageReactionDTO {
  emoji: string;
  userIds: AccountID[];
  count: number;
}

export interface EncryptedMessageEnvelopeDTO {
  id: MessageID;
  conversationId: ConversationID;
  senderAccountId: AccountID;
  senderDeviceId: DeviceID;
  clientMessageId: string;
  algorithm: string;
  cryptoVersion: number;
  nonce: string;
  ciphertext: string;
  recipients: EncryptedRecipientKeyDTO[];
  attachments: AttachmentMetaDTO[];
  replyToMessageId: MessageID | null;
  forwardedFromMessageId: MessageID | null;
  ttlSeconds: number | null;
  createdAt: ISO8601Timestamp;
  editedAt: ISO8601Timestamp | null;
  deletedAt: ISO8601Timestamp | null;
  expiresAt: ISO8601Timestamp | null;
  serverSequence: number;
}

export interface MessageReceiptDTO {
  id: ReceiptID;
  messageId: MessageID;
  deviceId: DeviceID;
  receiptType: ReceiptType;
  createdAt: ISO8601Timestamp;
}

export interface MessageDTO {
  envelope: EncryptedMessageEnvelopeDTO;
  deliveryState: DeliveryState;
  deliveredAt: ISO8601Timestamp | null;
  failedReason: string | null;
  receipts: MessageReceiptDTO[];
  reactions?: MessageReactionDTO[];
}

export interface CreateDirectConversationRequest {
  peerAccountId: AccountID;
  defaultTtlSeconds?: number;
}

export interface CreateGroupConversationRequest {
  title: string;
  memberAccountIds: AccountID[];
  defaultTtlSeconds?: number;
}

export interface CreateConversationResponse {
  conversation: ConversationDTO;
}

export interface ListConversationsResponse {
  conversations: ConversationDTO[];
}

export interface ConversationSummaryLastMessageDTO {
  id: MessageID;
  senderAccountId: AccountID;
  senderDeviceId: DeviceID;
  createdAt: ISO8601Timestamp;
  serverSequence: number;
  deliveryState: DeliveryState;
}

export interface ConversationSummaryDTO {
  id: ConversationID;
  type: ConversationType;
  title: string | null;
  updatedAt: ISO8601Timestamp;
  lastServerSequence: number;
  membersCount: number;
  directPeerAccountId: AccountID | null;
  directPeerEmail: string | null;
  lastMessage: ConversationSummaryLastMessageDTO | null;
}

export interface ListConversationSummariesResponse {
  summaries: ConversationSummaryDTO[];
  total: number;
  offset: number;
  limit: number;
}

export interface UserSearchItemDTO {
  accountId: AccountID;
  username: string;
  displayName: string;
  avatarMediaId: MediaID | null;
  createdAt: ISO8601Timestamp;
}

export interface UserSearchResponse {
  users: UserSearchItemDTO[];
  total: number;
  limit: number;
}

export interface UserPublicProfileResponse {
  accountId: AccountID;
  username: string;
  displayName: string;
  avatarMediaId: MediaID | null;
  bannerMediaId: MediaID | null;
  bio: string;
  statusText: string;
  websiteUrl: string | null;
  location: string | null;
  birthDate: ISO8601Timestamp | null;
  friendState: FriendState;
  friendCount: number;
  photoCount: number;
  createdAt: ISO8601Timestamp;
  postCount: number;
  canStartDirectChat: boolean;
  existingDirectConversationId: ConversationID | null;
  canViewPosts: boolean;
  canViewPhotos: boolean;
  canViewStories: boolean;
  canViewFriends: boolean;
  canSendFriendRequest: boolean;
}

export interface SocialPostDTO {
  id: PostID;
  authorAccountId: AccountID;
  authorEmail: string;
  authorDisplayName: string;
  authorUsername: string;
  authorAvatarId: MediaID | null;
  content: string;
  mediaType: SocialMediaType | null;
  mediaUrl: string | null;
  mediaId: MediaID | null;
  media: MediaDTO | null;
  mood: string | null;
  likeCount: number;
  likedByMe: boolean;
  canDelete: boolean;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
}

export interface SocialNotificationDTO {
  postId: PostID;
  actorAccountId: AccountID;
  actorEmail: string;
  postPreview: string;
  createdAt: ISO8601Timestamp;
}

export interface CreateSocialPostRequest {
  content: string;
  mediaType?: SocialMediaType;
  mediaUrl?: string;
  mediaId?: MediaID;
  mood?: string;
}

export interface ListSocialPostsResponse {
  posts: SocialPostDTO[];
}

export interface CreateSocialPostResponse {
  post: SocialPostDTO;
}

export interface SocialPostLikeResponse {
  likeCount: number;
  likedByMe: boolean;
}

export interface SocialNotificationsResponse {
  notifications: SocialNotificationDTO[];
}

export interface ProfilePrivacySettingsDTO {
  profileVisibility: VisibilityScope;
  postsVisibility: VisibilityScope;
  photosVisibility: VisibilityScope;
  storiesVisibility: VisibilityScope;
  friendsVisibility: VisibilityScope;
  birthDateVisibility: VisibilityScope;
  locationVisibility: VisibilityScope;
  linksVisibility: VisibilityScope;
  friendRequestsPolicy: FriendRequestPolicy;
  dmPolicy: DirectMessagePolicy;
  updatedAt: ISO8601Timestamp;
}

export interface ProfileDTO {
  accountId: AccountID;
  displayName: string;
  username: string;
  email?: string;
  bio: string;
  statusText: string;
  birthDate: ISO8601Timestamp | null;
  location: string | null;
  websiteUrl: string | null;
  avatarMediaId: MediaID | null;
  bannerMediaId: MediaID | null;
  friendState: FriendState;
  postCount: number;
  photoCount: number;
  friendCount: number;
  canStartDirectChat: boolean;
  existingDirectConversationId: ConversationID | null;
  canViewPosts: boolean;
  canViewPhotos: boolean;
  canViewStories: boolean;
  canViewFriends: boolean;
  canSendFriendRequest: boolean;
  createdAt: ISO8601Timestamp;
  privacy: ProfilePrivacySettingsDTO;
}

export interface ProfileUpdateRequest {
  displayName?: string | null;
  username?: string | null;
  bio?: string | null;
  statusText?: string | null;
  birthDate?: string | null;
  location?: string | null;
  websiteUrl?: string | null;
  avatarMediaId?: MediaID | null;
  bannerMediaId?: MediaID | null;
}

export interface ProfileResponse {
  profile: ProfileDTO;
}

export interface ProfileSearchResponse {
  profiles: ProfileDTO[];
  total: number;
}

export interface PrivacyUpdateRequest {
  profileVisibility?: VisibilityScope;
  postsVisibility?: VisibilityScope;
  photosVisibility?: VisibilityScope;
  storiesVisibility?: VisibilityScope;
  friendsVisibility?: VisibilityScope;
  birthDateVisibility?: VisibilityScope;
  locationVisibility?: VisibilityScope;
  linksVisibility?: VisibilityScope;
  friendRequestsPolicy?: FriendRequestPolicy;
  dmPolicy?: DirectMessagePolicy;
}

export interface PrivacyResponse {
  privacy: ProfilePrivacySettingsDTO;
}

export interface FriendListItemDTO {
  accountId: AccountID;
  username: string;
  displayName: string;
  avatarMediaId: MediaID | null;
  createdAt: ISO8601Timestamp;
}

export interface FriendRequestDTO {
  id: FriendRequestID;
  fromAccountId: AccountID;
  toAccountId: AccountID;
  status: FriendRequestStatus;
  direction: "incoming" | "outgoing";
  isOutgoing: boolean;
  createdAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  actor: FriendListItemDTO;
  target: FriendListItemDTO;
}

export interface FriendListResponse {
  friends: FriendListItemDTO[];
  total: number;
}

export interface FriendRequestsResponse {
  requests: FriendRequestDTO[];
  total: number;
  direction: "incoming" | "outgoing";
}

export interface CreateFriendRequestBody {
  targetAccountId: AccountID;
}

export interface FriendRequestActionResponse {
  request: FriendRequestDTO;
}

export type MediaDomain = "profile" | "social" | "story";
export type MediaKind = "avatar" | "banner" | "photo" | "video" | "story_image" | "story_video";
export type MediaStatus = "active" | "processing" | "deleted";

export interface MediaDTO {
  id: MediaID;
  ownerAccountId: AccountID;
  domain: MediaDomain;
  kind: MediaKind;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  objectKey?: string;
  visibility: VisibilityScope;
  status: MediaStatus;
  createdAt: ISO8601Timestamp;
  expiresAt: ISO8601Timestamp | null;
  contentUrl: string;
}

export interface MediaMetadataResponse {
  media: MediaDTO;
}

export interface MediaUploadResponse {
  media: MediaDTO;
}

export interface StoryDTO {
  id: StoryID;
  ownerAccountId: AccountID;
  ownerName: string;
  ownerUsername: string;
  ownerAvatarId: MediaID | null;
  caption: string;
  visibility: VisibilityScope;
  createdAt: ISO8601Timestamp;
  expiresAt: ISO8601Timestamp;
  media: MediaDTO | null;
}

export interface CreateStoryRequest {
  mediaId: MediaID;
  caption?: string;
  visibility?: VisibilityScope;
}

export interface StoryResponse {
  story: StoryDTO;
}

export interface StoryFeedResponse {
  stories: StoryDTO[];
  total: number;
}

export interface NotificationDTO {
  id: string;
  type: NotificationType;
  actorAccountId: AccountID | null;
  actorName: string | null;
  actorUsername: string | null;
  targetId: string | null;
  preview: string | null;
  isRead: boolean;
  readAt: ISO8601Timestamp | null;
  navigation: NotificationNavigationDTO | null;
  createdAt: ISO8601Timestamp;
}

export interface NotificationNavigationDTO {
  target: NotificationNavigationTarget;
  accountId: AccountID | null;
  conversationId: ConversationID | null;
  postId: string | null;
}

export interface NotificationsResponse {
  notifications: NotificationDTO[];
  total: number;
  unreadTotal: number;
}

export interface MarkNotificationsReadRequest {
  ids?: string[];
  all?: boolean;
}

export interface MarkNotificationsReadResponse {
  ok: boolean;
  unreadTotal: number;
}

export interface ClearNotificationsResponse {
  ok: boolean;
  unreadTotal: number;
}

export interface ConversationDetailsResponse {
  conversation: ConversationDTO;
}

export interface AddConversationMemberRequest {
  memberAccountId: AccountID;
  role?: ConversationRole;
}

export interface SendMessageRequest {
  clientMessageId: string;
  algorithm: string;
  cryptoVersion: number;
  nonce: string;
  ciphertext: string;
  recipients: EncryptedRecipientKeyDTO[];
  attachmentIds?: AttachmentID[];
  replyToMessageId?: MessageID;
  forwardedFromMessageId?: MessageID;
  ttlSeconds?: number;
}

export interface SendMessageResponse {
  message: MessageDTO;
}

export interface EditMessageRequest {
  algorithm: string;
  cryptoVersion: number;
  nonce: string;
  ciphertext: string;
  recipients: EncryptedRecipientKeyDTO[];
}

export interface EditMessageResponse {
  message: MessageDTO;
}

export interface ToggleMessageReactionRequest {
  emoji: string;
}

export interface ToggleMessageReactionResponse {
  message: MessageDTO;
  active: boolean;
}

export interface DeleteMessageRequest {
  mode?: "me" | "all";
}

export interface DeleteMessageResponse {
  ok: boolean;
  mode: "me" | "all";
  message?: MessageDTO;
}

export interface ConversationTypingRequest {
  isTyping: boolean;
}

export interface ConversationTypingResponse {
  ok: boolean;
}

export interface ConversationMessagesResponse {
  conversationId: ConversationID;
  messages: MessageDTO[];
  nextCursor: number;
}

export interface MessageReceiptRequest {
  receiptType: ReceiptType;
}

export interface AttachmentUploadRequest {
  kind: AttachmentKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  algorithm: string;
  nonce: string;
  ciphertext: string;
}

export interface AttachmentUploadResponse {
  attachment: AttachmentMetaDTO;
}

export interface AttachmentDownloadResponse {
  attachment: AttachmentMetaDTO;
  ciphertext: string;
}

export interface SyncMessageEventDTO {
  type: "message";
  message: MessageDTO;
}

export interface SyncReceiptEventDTO {
  type: "receipt";
  receipt: MessageReceiptDTO;
}

export type SyncEventDTO = SyncMessageEventDTO | SyncReceiptEventDTO;

export interface SyncBatchDTO {
  cursorId: SyncCursorID;
  fromCursor: number;
  toCursor: number;
  events: SyncEventDTO[];
  hasMore: boolean;
}

export interface SyncBootstrapResponse {
  batch: SyncBatchDTO;
}

export interface SyncPollResponse {
  batch: SyncBatchDTO;
}

export interface TransportEndpointDTO {
  id: TransportEndpointID;
  url: string;
  mode: TransportMode;
  priority: number;
  enabled: boolean;
}

export interface TransportProfileDTO {
  name: string;
  reconnectBackoffMinMs: number;
  reconnectBackoffMaxMs: number;
  longPollTimeoutSeconds: number;
  longPollEnabled: boolean;
}

export interface TransportEndpointsResponse {
  profile: TransportProfileDTO;
  endpoints: TransportEndpointDTO[];
}

export type PluginDeclaredHook =
  | "conversation.changed"
  | "transport.state.changed"
  | "message.visible"
  | "command.executed";

export interface PluginManifest {
  apiVersion: "v1";
  id: PluginID;
  name: string;
  version: string;
  entrypoint: string;
  requestedPermissions: PluginCapability[];
  declaredHooks: PluginDeclaredHook[];
  uiContributions: {
    panels: Array<{
      id: PluginPanelID;
      title: string;
    }>;
  };
}

export interface PluginPermissionRequest {
  pluginId: PluginID;
  requestedPermissions: PluginCapability[];
}

export interface PluginCommandDTO {
  pluginId: PluginID;
  id: PluginCommandID;
  title: string;
}

export interface PluginPanelDTO {
  pluginId: PluginID;
  id: PluginPanelID;
  title: string;
  content: string;
}

export interface PluginRegistryItem {
  manifest: PluginManifest;
  status: PluginStatus;
  source: "bundled" | "local";
  sourceRef: string;
  grantedPermissions: PluginCapability[];
  lastError: string | null;
  discoveredAt: ISO8601Timestamp;
  updatedAt: ISO8601Timestamp;
  commands: PluginCommandDTO[];
  panels: PluginPanelDTO[];
}

export type PluginBridgeMethod =
  | "registerCommand"
  | "registerPanel"
  | "setPanelContent"
  | "pluginStorage.get"
  | "pluginStorage.set"
  | "pluginStorage.delete"
  | "pluginStorage.list"
  | "messages.getActiveConversationSummary"
  | "messages.getVisibleMessagesSanitized"
  | "events.subscribe"
  | "events.unsubscribe"
  | "notifications.showLocal";

export interface PluginBridgeRequest {
  pluginId: PluginID;
  requestId: string;
  method: PluginBridgeMethod;
  params?: Record<string, unknown>;
}

export interface PluginBridgeSuccessResponse {
  pluginId: PluginID;
  requestId: string;
  ok: true;
  result: unknown;
}

export interface PluginBridgeErrorResponse {
  pluginId: PluginID;
  requestId: string;
  ok: false;
  error: {
    code:
      | "plugin_manifest_invalid"
      | "plugin_permission_denied"
      | "plugin_runtime_init_failed"
      | "plugin_bridge_violation"
      | "plugin_load_failed"
      | "plugin_disabled"
      | "plugin_storage_unavailable";
    message: string;
  };
}

export type PluginBridgeResponse = PluginBridgeSuccessResponse | PluginBridgeErrorResponse;

export type PluginEventType = "conversation.changed" | "transport.state.changed" | "message.visible" | "command.executed";

export interface PluginEventPayload {
  id: PluginEventID;
  pluginId: PluginID;
  eventType: PluginEventType;
  payload: Record<string, unknown>;
  createdAt: ISO8601Timestamp;
}

export interface PublicClientConfigResponse {
  api_base: string;
  ws_url: string;
  api_prefix: string;
  policy_hints?: {
    auth_modes_supported: Array<"device" | "browser_session">;
    browser_session_default_persistence: SessionPersistenceMode;
    browser_session_allow_remembered: boolean;
  };
  transport_profile_hints?: {
    reconnect_backoff_min_ms: number;
    reconnect_backoff_max_ms: number;
    long_poll_timeout_sec: number;
    long_poll_enabled: boolean;
  };
}

export interface ClientBootstrapEnvelope {
  config: PublicClientConfigResponse;
  transport: {
    supportsWebSocket: boolean;
    supportsLongPoll: boolean;
  };
  session?: {
    state: TransportLifecycleState;
    recentEvents: TransportLifecycleEvent[];
  };
}
