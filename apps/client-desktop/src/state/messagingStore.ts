import type { ConversationDTO, MessageDTO } from "@project/protocol";
import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { OutboxItem } from "@/services/messaging/localEncryptedStore";

export type TransportModeState = "websocket" | "long_poll" | "none";
export type TransportStatusState = "connecting" | "connected" | "degraded" | "offline";
export type MessageLifecycleState =
  | "draft"
  | "encrypting"
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "failed"
  | "expired";

export interface LocalMessage extends MessageDTO {
  plaintext?: {
    text: string;
    attachments?: Array<{
      attachmentId: string;
      fileName: string;
      mimeType: string;
      sizeBytes: number;
      symmetricKey: string;
      nonce: string;
      checksumSha256: string;
      algorithm: string;
    }>;
    createdAt?: string;
  };
  decryptError?: string;
  expired?: boolean;
  lifecycle: MessageLifecycleState;
  retryableFailure?: boolean;
  failureCode?: string;
  lastUpdatedAt: string;
}

interface MessagingStore {
  initialized: boolean;
  loading: boolean;
  conversations: ConversationDTO[];
  messagesByConversation: Record<string, LocalMessage[]>;
  activeConversationId: string | null;
  readPositions: Record<string, number>;
  outbox: OutboxItem[];
  transport: {
    mode: TransportModeState;
    status: TransportStatusState;
    endpoint: string | null;
    lastError: string | null;
    lastCursor: number;
    updatedAt: string | null;
  };
  setInitialized: (value: boolean) => void;
  setLoading: (value: boolean) => void;
  setConversations: (items: ConversationDTO[]) => void;
  upsertConversation: (item: ConversationDTO) => void;
  setMessages: (conversationId: string, items: LocalMessage[]) => void;
  upsertMessage: (conversationId: string, message: LocalMessage) => void;
  updateMessageLifecycle: (
    conversationId: string,
    senderDeviceId: string,
    clientMessageId: string,
    patch: Pick<LocalMessage, "lifecycle" | "retryableFailure" | "failureCode">,
  ) => void;
  removeMessageByClientReference: (conversationId: string, senderDeviceId: string, clientMessageId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  markConversationRead: (conversationId: string, serverSequence?: number) => void;
  setOutbox: (items: OutboxItem[]) => void;
  setTransportState: (payload: Partial<MessagingStore["transport"]>) => void;
  reset: () => void;
}

export const useMessagingStore = create<MessagingStore>()(
  persist(
    (set) => ({
      initialized: false,
      loading: false,
      conversations: [],
      messagesByConversation: {},
      activeConversationId: null,
      readPositions: {},
      outbox: [],
      transport: {
        mode: "none",
        status: "offline",
        endpoint: null,
        lastError: null,
        lastCursor: 0,
        updatedAt: null,
      },
      setInitialized: (value) => set({ initialized: value }),
      setLoading: (value) => set({ loading: value }),
      setConversations: (items) => set({ conversations: items }),
      upsertConversation: (item) =>
        set((state) => {
          const existing = state.conversations.findIndex((conversation) => conversation.id === item.id);
          if (existing === -1) {
            return { conversations: [item, ...state.conversations] };
          }
          const next = [...state.conversations];
          next[existing] = item;
          return { conversations: next };
        }),
      setMessages: (conversationId, items) =>
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: dedupeAndSortMessages(items),
          },
        })),
      upsertMessage: (conversationId, message) =>
        set((state) => {
          const current = state.messagesByConversation[conversationId] ?? [];
          const normalizedMessage = ensureMessageDefaults(message);
          const existing = findMessageIndex(current, normalizedMessage);
          if (existing === -1) {
            return {
              messagesByConversation: {
                ...state.messagesByConversation,
                [conversationId]: dedupeAndSortMessages([...current, normalizedMessage]),
              },
            };
          }
          const next = [...current];
          next[existing] = mergeMessage(next[existing], normalizedMessage);
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: dedupeAndSortMessages(next),
            },
          };
        }),
      updateMessageLifecycle: (conversationId, senderDeviceId, clientMessageId, patch) =>
        set((state) => {
          const current = state.messagesByConversation[conversationId] ?? [];
          const index = current.findIndex((item) => isSameClientReference(item, senderDeviceId, clientMessageId));
          if (index === -1) {
            return state;
          }
          const next = [...current];
          next[index] = {
            ...next[index],
            lifecycle: patch.lifecycle,
            retryableFailure: patch.retryableFailure,
            failureCode: patch.failureCode,
            lastUpdatedAt: new Date().toISOString(),
          };
          return {
            messagesByConversation: {
              ...state.messagesByConversation,
              [conversationId]: next,
            },
          };
        }),
      removeMessageByClientReference: (conversationId, senderDeviceId, clientMessageId) =>
        set((state) => ({
          messagesByConversation: {
            ...state.messagesByConversation,
            [conversationId]: (state.messagesByConversation[conversationId] ?? []).filter(
              (item) => !isSameClientReference(item, senderDeviceId, clientMessageId),
            ),
          },
        })),
      setActiveConversation: (conversationId) => set({ activeConversationId: conversationId }),
      markConversationRead: (conversationId, serverSequence) =>
        set((state) => {
          const existing = state.readPositions[conversationId] ?? 0;
          const next =
            typeof serverSequence === "number" && Number.isFinite(serverSequence)
              ? Math.max(existing, Math.max(0, Math.floor(serverSequence)))
              : existing;
          return {
            readPositions: {
              ...state.readPositions,
              [conversationId]: next,
            },
          };
        }),
      setOutbox: (items) => set({ outbox: items }),
      setTransportState: (payload) =>
        set((state) => ({
          transport: {
            ...state.transport,
            ...payload,
            updatedAt: new Date().toISOString(),
          },
        })),
      reset: () =>
        set({
          initialized: false,
          loading: false,
          conversations: [],
          messagesByConversation: {},
          activeConversationId: null,
          readPositions: {},
          outbox: [],
          transport: {
            mode: "none",
            status: "offline",
            endpoint: null,
            lastError: null,
            lastCursor: 0,
            updatedAt: null,
          },
        }),
    }),
    {
      name: "secure-messenger-messaging-ui",
      partialize: (state) => ({
        activeConversationId: state.activeConversationId,
        readPositions: state.readPositions,
      }),
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...(persistedState as Partial<MessagingStore>),
      }),
    },
  ),
);

export function getCurrentCursor() {
  return getSafeCursor(useMessagingStore.getState().transport.lastCursor);
}

function getSafeCursor(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return Math.floor(value);
}

function dedupeAndSortMessages(items: LocalMessage[]): LocalMessage[] {
  const indexed = new Map<string, LocalMessage>();
  for (const item of items) {
    const normalized = ensureMessageDefaults(item);
    const key = getMessageIdentityKey(normalized);
    const existing = indexed.get(key);
    if (!existing) {
      indexed.set(key, normalized);
      continue;
    }
    indexed.set(key, mergeMessage(existing, normalized));
  }

  return [...indexed.values()].sort((left, right) => {
    const sequenceDiff = left.envelope.serverSequence - right.envelope.serverSequence;
    if (sequenceDiff !== 0) {
      return sequenceDiff;
    }
    if (left.envelope.createdAt < right.envelope.createdAt) {
      return -1;
    }
    if (left.envelope.createdAt > right.envelope.createdAt) {
      return 1;
    }
    if (left.envelope.id < right.envelope.id) {
      return -1;
    }
    if (left.envelope.id > right.envelope.id) {
      return 1;
    }
    return 0;
  });
}

function ensureMessageDefaults(item: LocalMessage): LocalMessage {
  return {
    ...item,
    lifecycle: item.lifecycle ?? lifecycleFromDeliveryState(item),
    lastUpdatedAt: item.lastUpdatedAt ?? new Date().toISOString(),
  };
}

function lifecycleFromDeliveryState(item: LocalMessage): MessageLifecycleState {
  if (item.expired) {
    return "expired";
  }
  switch (item.deliveryState) {
    case "queued":
      return "queued";
    case "sent":
      return "sent";
    case "delivered":
      return "delivered";
    case "failed":
      return "failed";
    case "expired":
      return "expired";
    case "pending":
    default:
      return "sending";
  }
}

function getMessageIdentityKey(item: LocalMessage): string {
  const senderDeviceID = item.envelope.senderDeviceId;
  const clientMessageID = item.envelope.clientMessageId;
  if (senderDeviceID && clientMessageID) {
    return `client:${senderDeviceID}:${clientMessageID}`;
  }
  return `id:${item.envelope.id}`;
}

function findMessageIndex(items: LocalMessage[], target: LocalMessage): number {
  const targetKey = getMessageIdentityKey(target);
  return items.findIndex((item) => getMessageIdentityKey(item) === targetKey || item.envelope.id === target.envelope.id);
}

function isSameClientReference(item: LocalMessage, senderDeviceId: string, clientMessageId: string): boolean {
  return item.envelope.senderDeviceId === senderDeviceId && item.envelope.clientMessageId === clientMessageId;
}

function mergeMessage(existing: LocalMessage, incoming: LocalMessage): LocalMessage {
  return {
    ...existing,
    ...incoming,
    plaintext: incoming.plaintext ?? existing.plaintext,
    decryptError: incoming.decryptError ?? existing.decryptError,
    retryableFailure: incoming.retryableFailure ?? existing.retryableFailure,
    failureCode: incoming.failureCode ?? existing.failureCode,
    lifecycle: incoming.lifecycle ?? existing.lifecycle,
    lastUpdatedAt: incoming.lastUpdatedAt ?? new Date().toISOString(),
  };
}
