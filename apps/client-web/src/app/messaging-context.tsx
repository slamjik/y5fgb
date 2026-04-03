import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import type {
  ConversationDTO,
  ConversationMessagesResponse,
  CreateConversationResponse,
  ListConversationsResponse,
  MessageDTO,
} from "@project/protocol";
import { blockedCryptoFacade } from "@project/client-core";

import { HttpRequestError } from "../lib/http";
import { requestJSONWithAuth } from "../lib/authed-request";
import { useAuth } from "./auth-context";
import { useBootstrap } from "./bootstrap-context";

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface MessageCollectionState {
  items: MessageDTO[];
  status: LoadStatus;
  error: string | null;
  nextCursor: number;
}

interface MessagingContextValue {
  conversations: ConversationDTO[];
  conversationsStatus: LoadStatus;
  conversationsError: string | null;
  selectedConversationId: string | null;
  selectedConversation: ConversationDTO | null;
  activeMessages: MessageDTO[];
  activeMessagesStatus: LoadStatus;
  activeMessagesError: string | null;
  cryptoStatus: "full" | "partial" | "blocked";
  composerDisabledReason: string | null;
  refreshConversations: () => Promise<void>;
  selectConversation: (conversationId: string) => Promise<void>;
  reloadActiveMessages: () => Promise<void>;
  createDirectConversation: (peerAccountId: string) => Promise<string | null>;
  createGroupConversation: (title: string, memberAccountIds: string[]) => Promise<string | null>;
}

const initialMessagesState: MessageCollectionState = {
  items: [],
  status: "idle",
  error: null,
  nextCursor: 0,
};

const MessagingContext = createContext<MessagingContextValue | null>(null);

export function MessagingProvider({ children }: { children: React.ReactNode }) {
  const bootstrap = useBootstrap();
  const auth = useAuth();

  const [conversations, setConversations] = useState<ConversationDTO[]>([]);
  const [conversationsStatus, setConversationsStatus] = useState<LoadStatus>("idle");
  const [conversationsError, setConversationsError] = useState<string | null>(null);
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [messagesByConversation, setMessagesByConversation] = useState<Record<string, MessageCollectionState>>({});
  const messagesStateRef = useRef<Record<string, MessageCollectionState>>({});

  const cryptoStatus = blockedCryptoFacade.supportLevel();
  const composerDisabledReason =
    cryptoStatus === "blocked"
      ? "Отправка сообщений в веб-версии временно недоступна. Мы включим её после завершения криптографической интеграции для браузера."
      : null;

  const authRequestContext = useMemo(() => {
    if (bootstrap.status !== "ready" || !bootstrap.serverConfig) {
      return null;
    }
    return {
      apiBaseUrl: bootstrap.serverConfig.apiBaseUrl,
      apiPrefix: bootstrap.serverConfig.apiPrefix,
      getAccessToken: auth.getAccessToken,
      refreshAccessToken: auth.refreshAccessToken,
      onForbidden: () => {
        void auth.logout();
      },
    };
  }, [auth.getAccessToken, auth.logout, auth.refreshAccessToken, bootstrap.serverConfig, bootstrap.status]);

  const loadConversations = useCallback(async () => {
    if (auth.phase !== "authenticated" || !authRequestContext) {
      setConversations([]);
      setConversationsStatus("idle");
      setConversationsError(null);
      setSelectedConversationId(null);
      setMessagesByConversation({});
      return;
    }

    setConversationsStatus("loading");
    setConversationsError(null);

    try {
      const response = await requestJSONWithAuth<ListConversationsResponse>(authRequestContext, {
        method: "GET",
        path: "/conversations",
      });
      setConversations(response.conversations);
      setConversationsStatus("ready");

      setSelectedConversationId((current) => {
        if (current && response.conversations.some((conversation) => conversation.id === current)) {
          return current;
        }
        return response.conversations[0]?.id ?? null;
      });
    } catch (error) {
      setConversationsStatus("error");
      setConversationsError(mapRequestError(error));
    }
  }, [auth.phase, authRequestContext]);

  const loadMessages = useCallback(
    async (conversationId: string, forceReload = false) => {
      if (!conversationId || auth.phase !== "authenticated" || !authRequestContext) {
        return;
      }

      if (!forceReload && messagesStateRef.current[conversationId]?.status === "ready") {
        return;
      }

      setMessagesByConversation((state) => ({
        ...state,
        [conversationId]: {
          ...(state[conversationId] ?? initialMessagesState),
          status: "loading",
          error: null,
        },
      }));

      try {
        const response = await requestJSONWithAuth<ConversationMessagesResponse>(authRequestContext, {
          method: "GET",
          path: `/conversations/${conversationId}/messages?limit=120`,
        });

        setMessagesByConversation((state) => ({
          ...state,
          [conversationId]: {
            items: response.messages,
            status: "ready",
            error: null,
            nextCursor: response.nextCursor,
          },
        }));
      } catch (error) {
        setMessagesByConversation((state) => ({
          ...state,
          [conversationId]: {
            ...(state[conversationId] ?? initialMessagesState),
            status: "error",
            error: mapRequestError(error),
          },
        }));
      }
    },
    [auth.phase, authRequestContext],
  );

  const selectConversation = useCallback(
    async (conversationId: string) => {
      setSelectedConversationId(conversationId);
      await loadMessages(conversationId);
    },
    [loadMessages],
  );

  const reloadActiveMessages = useCallback(async () => {
    if (!selectedConversationId) {
      return;
    }
    await loadMessages(selectedConversationId, true);
  }, [loadMessages, selectedConversationId]);

  const createDirectConversation = useCallback(
    async (peerAccountId: string): Promise<string | null> => {
      if (!peerAccountId.trim() || auth.phase !== "authenticated" || !authRequestContext) {
        return null;
      }

      try {
        const response = await requestJSONWithAuth<CreateConversationResponse>(authRequestContext, {
          method: "POST",
          path: "/conversations/direct",
          body: {
            peerAccountId: peerAccountId.trim(),
          },
        });
        await loadConversations();
        const nextId = response.conversation.id;
        setSelectedConversationId(nextId);
        await loadMessages(nextId, true);
        return nextId;
      } catch (error) {
        setConversationsError(mapRequestError(error));
        setConversationsStatus("error");
        return null;
      }
    },
    [auth.phase, authRequestContext, loadConversations, loadMessages],
  );

  const createGroupConversation = useCallback(
    async (title: string, memberAccountIds: string[]): Promise<string | null> => {
      if (!title.trim() || auth.phase !== "authenticated" || !authRequestContext) {
        return null;
      }

      const members = memberAccountIds.map((item) => item.trim()).filter(Boolean);

      try {
        const response = await requestJSONWithAuth<CreateConversationResponse>(authRequestContext, {
          method: "POST",
          path: "/conversations/group",
          body: {
            title: title.trim(),
            memberAccountIds: members,
          },
        });
        await loadConversations();
        const nextId = response.conversation.id;
        setSelectedConversationId(nextId);
        await loadMessages(nextId, true);
        return nextId;
      } catch (error) {
        setConversationsError(mapRequestError(error));
        setConversationsStatus("error");
        return null;
      }
    },
    [auth.phase, authRequestContext, loadConversations, loadMessages],
  );

  useEffect(() => {
    messagesStateRef.current = messagesByConversation;
  }, [messagesByConversation]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!selectedConversationId) {
      return;
    }
    void loadMessages(selectedConversationId);
  }, [loadMessages, selectedConversationId]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.id === selectedConversationId) ?? null,
    [conversations, selectedConversationId],
  );

  const activeMessageState = selectedConversationId ? messagesByConversation[selectedConversationId] ?? initialMessagesState : initialMessagesState;

  const value = useMemo<MessagingContextValue>(
    () => ({
      conversations,
      conversationsStatus,
      conversationsError,
      selectedConversationId,
      selectedConversation,
      activeMessages: activeMessageState.items,
      activeMessagesStatus: activeMessageState.status,
      activeMessagesError: activeMessageState.error,
      cryptoStatus,
      composerDisabledReason,
      refreshConversations: loadConversations,
      selectConversation,
      reloadActiveMessages,
      createDirectConversation,
      createGroupConversation,
    }),
    [
      activeMessageState.error,
      activeMessageState.items,
      activeMessageState.status,
      composerDisabledReason,
      conversations,
      conversationsError,
      conversationsStatus,
      createDirectConversation,
      createGroupConversation,
      cryptoStatus,
      loadConversations,
      reloadActiveMessages,
      selectConversation,
      selectedConversation,
      selectedConversationId,
    ],
  );

  return <MessagingContext.Provider value={value}>{children}</MessagingContext.Provider>;
}

export function useMessaging(): MessagingContextValue {
  const context = useContext(MessagingContext);
  if (!context) {
    throw new Error("useMessaging must be used inside MessagingProvider");
  }
  return context;
}

function mapRequestError(error: unknown): string {
  if (error instanceof HttpRequestError) {
    if (error.code === "endpoint_unreachable") {
      return "Сервер недоступен. Проверьте подключение и попробуйте снова.";
    }
    if (error.code === "conversation_not_found") {
      return "Диалог не найден.";
    }
    if (error.code === "membership_denied") {
      return "Недостаточно прав для доступа к диалогу.";
    }
    return "Не удалось выполнить запрос. Попробуйте ещё раз.";
  }
  if (error instanceof Error) {
    return "Не удалось выполнить запрос. Попробуйте ещё раз.";
  }
  return "Не удалось выполнить запрос. Попробуйте ещё раз.";
}
