import type { AttachmentMetaDTO, ConversationDTO, ConversationSummaryDTO, MessageDTO, NotificationsResponse } from "@project/protocol";
import type { RuntimeTransportState } from "../features/messaging/runtime";
import type { ServerBootstrapConfig } from "@project/client-core";

import type { SidebarSection } from "./components/Sidebar";

export type SessionMode = "ephemeral" | "remembered";
export type AuthMode = "login" | "register";
export type ChatFilter = "all" | "direct" | "group" | "unread";
export type SettingsSection = "account" | "sessions" | "devices" | "security" | "privacy" | "app" | "connection";

export type SavedServer = {
  input: string;
  config: ServerBootstrapConfig;
};

export type SessionState = {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  email: string;
  deviceId: string;
};

export type DeviceMaterial = {
  name: string;
  platform: string;
  publicKey: string;
  privateKey: string;
};

export type AttachmentSecret = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  symmetricKey: string;
  nonce: string;
  checksumSha256: string;
  algorithm: string;
};

export type MessageAttachmentView = {
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

export type UploadDraft = {
  id: string;
  file: File;
};

export type MessageView = {
  id: string;
  conversationId: string;
  senderAccountId: string;
  createdAt: string;
  editedAt: string | null;
  serverSequence: number;
  text: string;
  attachments: MessageAttachmentView[];
  own: boolean;
  deliveryState: string;
  readByMe: boolean;
  readByOthersAt: string | null;
  localStatus?: "sending" | "failed";
  retryText?: string;
};

export type MessageBucket = {
  loading: boolean;
  loadingMore?: boolean;
  error: string;
  hasMore?: boolean;
  nextCursor?: number;
  items: MessageView[];
};

export type UploadFeedbackPhase = "idle" | "uploading" | "success" | "error";

export type UploadFeedback = {
  phase: UploadFeedbackPhase;
  percent: number;
  message: string;
};

export type MessageRowAttachmentState = Record<string, { loading: boolean; error: string }>;

export type LoadSummariesFn = (
  conversationId: string,
) => Promise<void>;

export type MessagingSectionShared = {
  section: SidebarSection;
  transportState: RuntimeTransportState;
  resolveConversationTitle: (summary: ConversationSummaryDTO | null) => string;
  renderDeliveryState: (value: string) => string;
  sectionTitle: (section: SidebarSection) => string;
  sectionSubtitle: (section: SidebarSection, server: string, transportState: RuntimeTransportState) => string;
  normalizeUserSearchInput: (value: string) => string;
  renderVisibilityScope: (value: string) => string;
  renderFriendState: (value: string) => string;
  renderNotificationTitle: (item: NotificationsResponse["notifications"][number]) => string;
  mapMessageAttachments: (
    attachments: AttachmentMetaDTO[] | undefined,
    secrets: AttachmentSecret[],
  ) => MessageAttachmentView[];
  upsertMessageItems: (current: MessageView[], incoming: MessageView[]) => MessageView[];
  applyOwnMessageFallback: (
    message: MessageView,
    fallbackText: string,
    envelopeAttachments: AttachmentMetaDTO[] | undefined,
    attachmentSecrets: AttachmentSecret[],
  ) => MessageView;
  collectRecipients: (members: ConversationDTO["members"]) => Array<{ recipientDeviceId: string; publicKey: string }>;
  decodeMessage: (message: MessageDTO, session: SessionState, device: DeviceMaterial | null) => Promise<MessageView>;
};

