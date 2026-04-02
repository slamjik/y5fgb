import type {
  AttachmentDownloadResponse,
  AttachmentUploadRequest,
  AttachmentUploadResponse,
  ConversationDetailsResponse,
  ConversationMessagesResponse,
  CreateConversationResponse,
  CreateDirectConversationRequest,
  CreateGroupConversationRequest,
  ListConversationsResponse,
  MessageReceiptRequest,
  SendMessageRequest,
  SendMessageResponse,
  SyncBootstrapResponse,
  SyncPollResponse,
  TransportEndpointsResponse,
} from "@project/protocol";

import { absoluteApiRequest, apiRequest } from "@/services/apiClient";
import { getActiveServerConfig } from "@/services/serverConnection";

export const messagingApi = {
  createDirect(accessToken: string, payload: CreateDirectConversationRequest) {
    return apiRequest<CreateConversationResponse>({
      path: "/conversations/direct",
      method: "POST",
      accessToken,
      body: payload,
    });
  },

  createGroup(accessToken: string, payload: CreateGroupConversationRequest) {
    return apiRequest<CreateConversationResponse>({
      path: "/conversations/group",
      method: "POST",
      accessToken,
      body: payload,
    });
  },

  listConversations(accessToken: string) {
    return apiRequest<ListConversationsResponse>({
      path: "/conversations",
      method: "GET",
      accessToken,
    });
  },

  getConversation(accessToken: string, conversationId: string) {
    return apiRequest<ConversationDetailsResponse>({
      path: `/conversations/${conversationId}`,
      method: "GET",
      accessToken,
    });
  },

  addMember(accessToken: string, conversationId: string, payload: { memberAccountId: string; role?: string }) {
    return apiRequest<ConversationDetailsResponse>({
      path: `/conversations/${conversationId}/members`,
      method: "POST",
      accessToken,
      body: payload,
    });
  },

  sendMessage(accessToken: string, conversationId: string, payload: SendMessageRequest) {
    return apiRequest<SendMessageResponse>({
      path: `/conversations/${conversationId}/messages`,
      method: "POST",
      accessToken,
      body: payload,
    });
  },

  listMessages(accessToken: string, conversationId: string, options?: { limit?: number; beforeSequence?: number }) {
    const params = new URLSearchParams();
    if (options?.limit) {
      params.set("limit", String(options.limit));
    }
    if (options?.beforeSequence) {
      params.set("beforeSequence", String(options.beforeSequence));
    }
    const suffix = params.size > 0 ? `?${params.toString()}` : "";
    return apiRequest<ConversationMessagesResponse>({
      path: `/conversations/${conversationId}/messages${suffix}`,
      method: "GET",
      accessToken,
    });
  },

  createReceipt(accessToken: string, messageId: string, payload: MessageReceiptRequest) {
    return apiRequest<{ receipt: unknown }>({
      path: `/messages/${messageId}/receipts`,
      method: "POST",
      accessToken,
      body: payload,
    });
  },

  uploadAttachment(accessToken: string, payload: AttachmentUploadRequest) {
    return apiRequest<AttachmentUploadResponse>({
      path: "/attachments/upload",
      method: "POST",
      accessToken,
      body: payload,
    });
  },

  downloadAttachment(accessToken: string, attachmentId: string) {
    return apiRequest<AttachmentDownloadResponse>({
      path: `/attachments/${attachmentId}/download`,
      method: "GET",
      accessToken,
    });
  },

  syncBootstrap(accessToken: string, limit = 100) {
    return apiRequest<SyncBootstrapResponse>({
      path: `/sync/bootstrap?limit=${limit}`,
      method: "GET",
      accessToken,
    });
  },

  syncPoll(accessToken: string, cursor: number, timeoutSec: number, limit = 100) {
    return apiRequest<SyncPollResponse>({
      path: `/sync/poll?cursor=${cursor}&timeoutSec=${timeoutSec}&limit=${limit}`,
      method: "GET",
      accessToken,
    });
  },

  syncPollAtEndpoint(accessToken: string, endpointUrl: string, cursor: number, timeoutSec: number, limit = 100) {
    const endpoint = buildSyncPollEndpoint(endpointUrl, cursor, timeoutSec, limit);
    return absoluteApiRequest<SyncPollResponse>({
      url: endpoint,
      method: "GET",
      accessToken,
    });
  },

  transportEndpoints(accessToken: string) {
    return apiRequest<TransportEndpointsResponse>({
      path: "/transport/endpoints",
      method: "GET",
      accessToken,
    });
  },
};

function buildSyncPollEndpoint(endpointUrl: string, cursor: number, timeoutSec: number, limit: number): string {
  const server = getActiveServerConfig();
  const endpoint = endpointUrl.startsWith("http://") || endpointUrl.startsWith("https://")
    ? new URL(endpointUrl)
    : new URL(endpointUrl, server.apiBaseUrl);
  endpoint.searchParams.set("cursor", String(cursor));
  endpoint.searchParams.set("timeoutSec", String(timeoutSec));
  endpoint.searchParams.set("limit", String(limit));
  return endpoint.toString();
}
