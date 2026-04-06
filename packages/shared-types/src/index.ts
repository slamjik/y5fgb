export type Brand<T, TBrand extends string> = T & { readonly __brand: TBrand };

export type UserID = Brand<string, "UserID">;
export type AccountID = Brand<string, "AccountID">;
export type DeviceID = Brand<string, "DeviceID">;
export type DeviceRecipientID = Brand<string, "DeviceRecipientID">;
export type SessionID = Brand<string, "SessionID">;
export type ApprovalRequestID = Brand<string, "ApprovalRequestID">;
export type RecoveryFlowID = Brand<string, "RecoveryFlowID">;
export type SecurityEventID = Brand<string, "SecurityEventID">;
export type ConversationID = Brand<string, "ConversationID">;
export type AttachmentID = Brand<string, "AttachmentID">;
export type PostID = Brand<string, "PostID">;
export type ReceiptID = Brand<string, "ReceiptID">;
export type SyncCursorID = Brand<string, "SyncCursorID">;
export type TransportEndpointID = Brand<string, "TransportEndpointID">;
export type PluginID = Brand<string, "PluginID">;
export type PluginCommandID = Brand<string, "PluginCommandID">;
export type PluginPanelID = Brand<string, "PluginPanelID">;
export type PluginEventID = Brand<string, "PluginEventID">;
export type ChatID = Brand<string, "ChatID">;
export type MessageID = Brand<string, "MessageID">;

export type ISO8601Timestamp = Brand<string, "ISO8601Timestamp">;

export type ClientPlatform = "desktop-tauri" | "web-browser";
export type SessionClass = "device" | "browser";
export type SessionPersistenceMode = "ephemeral" | "remembered";

export type TransportLifecycleState =
  | "bootstrapping"
  | "unauthenticated"
  | "restoring_session"
  | "connecting"
  | "connected"
  | "degraded"
  | "offline"
  | "forbidden";

export type TransportLifecycleEvent =
  | "config_loaded"
  | "auth_restored"
  | "token_refreshed"
  | "ws_connected"
  | "ws_disconnected"
  | "poll_fallback_entered"
  | "resync_completed"
  | "visibility_changed"
  | "online_changed"
  | "transport_leader_changed";

export type PluginStatus = "discovered" | "installed" | "enabled" | "disabled" | "failed";

export type PluginCapability =
  | "ui.render"
  | "commands.register"
  | "storage.plugin_local"
  | "notifications.local"
  | "messages.read_active_conversation_summary"
  | "messages.read_visible_messages"
  | "events.subscribe"
  | "network.outbound"
  | "filesystem.read"
  | "filesystem.write"
  | "transport.control"
  | "auth.session"
  | "crypto.keys"
  | "identity.material";

export const asUserID = (value: string): UserID => value as UserID;
export const asAccountID = (value: string): AccountID => value as AccountID;
export const asDeviceID = (value: string): DeviceID => value as DeviceID;
export const asDeviceRecipientID = (value: string): DeviceRecipientID => value as DeviceRecipientID;
export const asSessionID = (value: string): SessionID => value as SessionID;
export const asApprovalRequestID = (value: string): ApprovalRequestID => value as ApprovalRequestID;
export const asRecoveryFlowID = (value: string): RecoveryFlowID => value as RecoveryFlowID;
export const asSecurityEventID = (value: string): SecurityEventID => value as SecurityEventID;
export const asConversationID = (value: string): ConversationID => value as ConversationID;
export const asAttachmentID = (value: string): AttachmentID => value as AttachmentID;
export const asPostID = (value: string): PostID => value as PostID;
export const asReceiptID = (value: string): ReceiptID => value as ReceiptID;
export const asSyncCursorID = (value: string): SyncCursorID => value as SyncCursorID;
export const asTransportEndpointID = (value: string): TransportEndpointID => value as TransportEndpointID;
export const asPluginID = (value: string): PluginID => value as PluginID;
export const asPluginCommandID = (value: string): PluginCommandID => value as PluginCommandID;
export const asPluginPanelID = (value: string): PluginPanelID => value as PluginPanelID;
export const asPluginEventID = (value: string): PluginEventID => value as PluginEventID;
export const asChatID = (value: string): ChatID => value as ChatID;
export const asMessageID = (value: string): MessageID => value as MessageID;
