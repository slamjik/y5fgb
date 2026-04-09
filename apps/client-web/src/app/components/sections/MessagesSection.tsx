import type { ConversationSummaryDTO, UserSearchResponse } from "@project/protocol";
import { ArrowLeft, Paperclip, Plus, RefreshCcw, Search, Send, X } from "lucide-react";
import * as React from "react";

import type { RuntimeTransportState } from "../../../features/messaging/runtime";
import type {
  ChatFilter,
  MessageAttachmentView,
  MessageBucket,
  MessageRowAttachmentState,
  MessageView,
  UploadDraft,
} from "../../types";
import { chatAttachmentInputAccept } from "../../upload-security";
import { formatBytes } from "../../view-utils";
import { cardStyle, innerCardStyle, outlineButtonStyle, selectedCardStyle, solidButtonStyle } from "../../styles";
import { MessageRow } from "../MessageRow";
import { InlineInfo, TransportCard } from "../common/StatusInfo";

type MessagesSectionProps = {
  conversationSearch: string;
  onConversationSearchChange: (value: string) => void;
  conversationFilter: ChatFilter;
  onConversationFilterChange: (value: ChatFilter) => void;
  showNewChat: boolean;
  onToggleNewChat: () => void;
  userSearchQuery: string;
  onUserSearchChange: (value: string) => void;
  userSearchResults: UserSearchResponse["users"];
  groupMembers: string[];
  onToggleGroupMember: (accountId: string) => void;
  onCreateDirect: (accountId: string) => void;
  groupTitle: string;
  onGroupTitleChange: (value: string) => void;
  onCreateGroup: () => void;
  summariesLoading: boolean;
  summariesError: string;
  summaries: ConversationSummaryDTO[];
  filteredSummaries: ConversationSummaryDTO[];
  activeConversationId: string | null;
  unreadByConversation: Record<string, number>;
  onOpenConversation: (conversationId: string) => void;
  onBackToList: () => void;
  showConversationListOnMobile: boolean;
  resolveConversationTitle: (summary: ConversationSummaryDTO | null) => string;
  onRefreshSummaries: () => void;
  activeBucket?: MessageBucket;
  messageScrollRef: React.MutableRefObject<HTMLDivElement | null>;
  attachmentInputRef: React.MutableRefObject<HTMLInputElement | null>;
  draftText: string;
  onDraftChange: (value: string) => void;
  replyTarget: MessageView | null;
  onClearReply: () => void;
  uploads: UploadDraft[];
  onAddUpload: (files: FileList | null) => void;
  onRemoveUpload: (uploadId: string) => void;
  onSendMessage: () => void;
  onResendMessage: (retryText: string) => Promise<void>;
  onEditMessage: (messageId: string, nextText: string) => Promise<void>;
  onReplyToMessage: (messageId: string) => void;
  onToggleReaction: (messageId: string, emoji: string) => void;
  onDeleteMessage: (messageId: string, mode: "me" | "all") => void;
  onForwardMessage: (messageId: string) => void;
  typingCount: number;
  onDownloadAttachment: (attachment: MessageAttachmentView) => Promise<void>;
  onEnsureAttachmentPreview: (attachment: MessageAttachmentView) => void;
  attachmentPreviewState: Record<string, { loading: boolean; src: string | null; error: string }>;
  onLoadOlderMessages: () => void;
  attachmentOps: MessageRowAttachmentState;
  transportState: RuntimeTransportState;
  serverInput: string;
  onReconnect: () => void;
};

const maxRenderedMessages = 260;

export function MessagesSection({
  conversationSearch,
  onConversationSearchChange,
  conversationFilter,
  onConversationFilterChange,
  showNewChat,
  onToggleNewChat,
  userSearchQuery,
  onUserSearchChange,
  userSearchResults,
  groupMembers,
  onToggleGroupMember,
  onCreateDirect,
  groupTitle,
  onGroupTitleChange,
  onCreateGroup,
  summariesLoading,
  summariesError,
  summaries,
  filteredSummaries,
  activeConversationId,
  unreadByConversation,
  onOpenConversation,
  onBackToList,
  showConversationListOnMobile,
  resolveConversationTitle,
  onRefreshSummaries,
  activeBucket,
  messageScrollRef,
  attachmentInputRef,
  draftText,
  onDraftChange,
  replyTarget,
  onClearReply,
  uploads,
  onAddUpload,
  onRemoveUpload,
  onSendMessage,
  onResendMessage,
  onEditMessage,
  onReplyToMessage,
  onToggleReaction,
  onDeleteMessage,
  onForwardMessage,
  typingCount,
  onDownloadAttachment,
  onEnsureAttachmentPreview,
  attachmentPreviewState,
  onLoadOlderMessages,
  attachmentOps,
  transportState,
  serverInput,
  onReconnect,
}: MessagesSectionProps) {
  const activeTitle = resolveConversationTitle(
    summaries.find((item) => (item.id as string) === activeConversationId) ?? null,
  );

  const messageRefMap = React.useRef<Map<string, HTMLDivElement | null>>(new Map());
  const [highlightedMessageId, setHighlightedMessageId] = React.useState<string | null>(null);
  const [showNewMessages, setShowNewMessages] = React.useState(false);
  const [isNearBottom, setIsNearBottom] = React.useState(true);
  const latestMessageIdRef = React.useRef<string | null>(null);

  const activeItems = activeBucket?.items ?? [];
  const hiddenCount = Math.max(0, activeItems.length - maxRenderedMessages);
  const renderedItems = hiddenCount > 0 ? activeItems.slice(-maxRenderedMessages) : activeItems;
  const byId = React.useMemo(() => {
    const map = new Map<string, MessageView>();
    for (const message of activeItems) {
      map.set(message.id, message);
    }
    return map;
  }, [activeItems]);

  React.useEffect(() => {
    latestMessageIdRef.current = null;
    setShowNewMessages(false);
    setIsNearBottom(true);
    const el = messageScrollRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
    });
  }, [activeConversationId, messageScrollRef]);

  React.useEffect(() => {
    const latest = activeItems[activeItems.length - 1];
    if (!latest) return;
    if (latestMessageIdRef.current === latest.id) return;
    latestMessageIdRef.current = latest.id;

    const el = messageScrollRef.current;
    if (!el) return;
    const bottomGap = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottomNow = bottomGap < 140;
    if (nearBottomNow || isNearBottom) {
      requestAnimationFrame(() => {
        el.scrollTop = el.scrollHeight;
      });
      setShowNewMessages(false);
      setIsNearBottom(true);
      return;
    }

    if (!latest.own) {
      setShowNewMessages(true);
    }
  }, [activeItems, isNearBottom, messageScrollRef]);

  React.useEffect(() => {
    if (!highlightedMessageId) return;
    const timer = window.setTimeout(() => setHighlightedMessageId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [highlightedMessageId]);

  const scrollToMessage = React.useCallback(
    (messageId: string) => {
      const target = messageRefMap.current.get(messageId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      setHighlightedMessageId(messageId);
    },
    [setHighlightedMessageId],
  );

  const jumpToLatest = () => {
    const el = messageScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setIsNearBottom(true);
    setShowNewMessages(false);
  };

  return (
    <section className="mobile-screen-shell grid gap-3 lg:grid-cols-[320px_1fr_280px] h-[calc(100dvh-216px)] lg:h-[calc(100vh-170px)] min-h-[420px] app-section-transition">
      <aside
        className={`${
          activeConversationId && !showConversationListOnMobile ? "hidden lg:flex" : "flex"
        } rounded-2xl border p-4 overflow-hidden flex-col chat-panel-transition`}
        style={cardStyle}
      >
        <div className="flex items-center gap-2 mb-3">
          <Search className="w-4 h-4" style={{ color: "var(--base-grey-light)" }} />
          <input
            data-testid="messages-search-input"
            value={conversationSearch}
            onChange={(e) => onConversationSearchChange(e.target.value)}
            placeholder="Поиск по чатам"
            className="w-full bg-transparent outline-none"
            style={{ color: "var(--text-primary)" }}
          />
        </div>
        <div className="flex gap-2 mb-3 flex-wrap">
          {(["all", "direct", "group", "unread"] as ChatFilter[]).map((value) => (
            <button
              key={value}
              type="button"
              className="px-2 py-1 rounded-lg border text-xs"
              style={conversationFilter === value ? solidButtonStyle : outlineButtonStyle}
              onClick={() => onConversationFilterChange(value)}
            >
              {value === "all"
                ? "Все"
                : value === "direct"
                  ? "Личные"
                  : value === "group"
                    ? "Группы"
                    : "Непрочитанные"}
            </button>
          ))}
        </div>
        <button
          type="button"
          data-testid="messages-refresh-list-button"
          className="mb-2 px-3 py-1.5 rounded-lg border text-sm"
          style={outlineButtonStyle}
          onClick={onRefreshSummaries}
        >
          <RefreshCcw className="w-4 h-4 inline mr-2" />
          Обновить список
        </button>
        <button
          type="button"
          data-testid="messages-new-chat-toggle"
          className="mb-3 px-3 py-2 rounded-lg border"
          style={outlineButtonStyle}
          onClick={onToggleNewChat}
        >
          <Plus className="w-4 h-4 inline mr-2" />
          Новый чат
        </button>

        {showNewChat ? (
          <div className="rounded-xl border p-3 mb-3 space-y-3 interactive-surface-subtle" style={innerCardStyle}>
            <input
              data-testid="messages-new-chat-search-input"
              value={userSearchQuery}
              onChange={(e) => onUserSearchChange(e.target.value)}
              placeholder="Поиск пользователя"
              className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
              style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
            />
            <div className="space-y-2 max-h-40 overflow-auto">
              {userSearchResults.map((user) => {
                const accountId = user.accountId as string;
                const selected = groupMembers.includes(accountId);
                return (
                  <div key={accountId} className="rounded-lg border p-2 interactive-surface-subtle" style={innerCardStyle}>
                    <p style={{ color: "var(--text-primary)", fontSize: 13 }}>
                      {user.displayName || user.username || "Пользователь"}
                    </p>
                    <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>@{user.username}</p>
                    <div className="flex gap-2 mt-2">
                      <button
                        type="button"
                        data-testid={`messages-create-direct-${accountId}`}
                        className="px-2 py-1 rounded-lg border text-xs"
                        style={outlineButtonStyle}
                        onClick={() => onCreateDirect(accountId)}
                      >
                        Личный
                      </button>
                      <button
                        type="button"
                        className="px-2 py-1 rounded-lg border text-xs"
                        style={selected ? solidButtonStyle : outlineButtonStyle}
                        onClick={() => onToggleGroupMember(accountId)}
                      >
                        {selected ? "Выбран" : "В группу"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
            <input
              data-testid="messages-new-group-title-input"
              value={groupTitle}
              onChange={(e) => onGroupTitleChange(e.target.value)}
              placeholder="Название группы"
              className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
              style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
            />
            <button
              type="button"
              data-testid="messages-create-group-button"
              className="w-full rounded-lg border px-3 py-2"
              style={outlineButtonStyle}
              onClick={onCreateGroup}
            >
              Создать группу
            </button>
          </div>
        ) : null}

        {summariesLoading ? <InlineInfo text="Загрузка чатов..." /> : null}
        {summariesError ? <InlineInfo tone="error" text={summariesError} /> : null}
        <div className="space-y-2 overflow-auto">
          {filteredSummaries.map((item) => {
            const id = item.id as string;
            const selected = activeConversationId === id;
            const unread = unreadByConversation[id] ?? 0;
            return (
              <button
                key={id}
                type="button"
                data-testid={`conversation-item-${id}`}
                className="w-full text-left rounded-xl border p-3 interactive-surface"
                style={selected ? selectedCardStyle : innerCardStyle}
                onClick={() => onOpenConversation(id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>{resolveConversationTitle(item)}</p>
                  {unread > 0 ? (
                    <span
                      className="px-2 py-0.5 rounded-full text-xs"
                      style={{ backgroundColor: "var(--accent-brown)", color: "var(--core-background)" }}
                    >
                      {unread > 99 ? "99+" : unread}
                    </span>
                  ) : null}
                </div>
                <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                  {item.lastMessage ? new Date(item.lastMessage.createdAt as string).toLocaleString("ru-RU") : "Без сообщений"}
                </p>
              </button>
            );
          })}
        </div>
      </aside>

      <section
        className={`${
          !activeConversationId || showConversationListOnMobile ? "hidden lg:flex" : "flex"
        } rounded-2xl border overflow-hidden flex-col min-h-[420px] chat-panel-transition`}
        style={cardStyle}
      >
        {!activeConversationId ? (
          <div className="h-full flex items-center justify-center">
            <InlineInfo text="Выберите чат слева" />
          </div>
        ) : (
          <React.Fragment key={activeConversationId}>
            <header className="px-3 lg:px-4 py-3 border-b flex items-center justify-between gap-2" style={{ borderColor: "var(--glass-border)" }}>
              <div className="min-w-0 flex items-center gap-2">
                <button
                  type="button"
                  data-testid="messages-back-to-list"
                  className="lg:hidden px-2 py-1 rounded-lg border"
                  style={outlineButtonStyle}
                  onClick={onBackToList}
                >
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div className="min-w-0">
                  <p data-testid="messages-active-title" className="truncate" style={{ color: "var(--text-primary)", fontWeight: 600 }}>{activeTitle}</p>
                  {typingCount > 0 ? (
                    <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Печатает...</p>
                  ) : null}
                </div>
              </div>
              <button
                type="button"
                data-testid="messages-refresh-button"
                className="px-3 py-1.5 rounded-lg border text-sm"
                style={outlineButtonStyle}
                onClick={onRefreshSummaries}
              >
                <RefreshCcw className="w-4 h-4 inline mr-2" />
                Обновить
              </button>
            </header>
            <div
              ref={messageScrollRef}
              className="flex-1 overflow-auto px-3 lg:px-4 py-3"
              onScroll={(event) => {
                const target = event.currentTarget;
                const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 140;
                setIsNearBottom(nearBottom);
                if (nearBottom) {
                  setShowNewMessages(false);
                }
              }}
            >
              <div className="space-y-1">
                {activeBucket?.hasMore ? (
                  <div className="text-center">
                    <button
                      type="button"
                      data-testid="messages-load-older-button"
                      className="px-3 py-1 rounded-lg border text-xs disabled:opacity-60"
                      style={outlineButtonStyle}
                      onClick={onLoadOlderMessages}
                      disabled={Boolean(activeBucket.loadingMore)}
                    >
                      {activeBucket.loadingMore ? "Загружаем..." : "Загрузить более старые"}
                    </button>
                  </div>
                ) : null}
                {hiddenCount > 0 ? <InlineInfo text={`Показаны последние ${renderedItems.length} сообщений.`} /> : null}
                {activeBucket?.loading ? <InlineInfo text="Загрузка истории..." /> : null}
                {activeBucket?.error ? (
                  <div className="space-y-2">
                    <InlineInfo tone="error" text={activeBucket.error} />
                    <button type="button" className="px-3 py-1.5 rounded-lg border text-sm" style={outlineButtonStyle} onClick={onReconnect}>
                      Повторить подключение
                    </button>
                  </div>
                ) : null}
                {activeBucket && activeBucket.items.length === 0 ? <InlineInfo text="В чате пока нет сообщений." /> : null}
                {renderedItems.map((message, index) => {
                  const previous = index > 0 ? renderedItems[index - 1] : null;
                  const showDate = !previous || !isSameDay(previous.createdAt, message.createdAt);
                  const compactTop =
                    Boolean(previous) &&
                    !showDate &&
                    previous?.senderAccountId === message.senderAccountId &&
                    Math.abs(new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime()) < 5 * 60 * 1000;

                  return (
                    <React.Fragment key={message.id}>
                      {showDate ? <DateSeparator value={message.createdAt} /> : null}
                      <MessageRow
                        message={message}
                        replySource={message.replyToMessageId ? byId.get(message.replyToMessageId) ?? null : null}
                        compactTop={compactTop}
                        highlighted={highlightedMessageId === message.id}
                        onJumpToMessage={scrollToMessage}
                        onReplyToMessage={onReplyToMessage}
                        onToggleReaction={onToggleReaction}
                        onDeleteMessage={onDeleteMessage}
                        onForwardMessage={onForwardMessage}
                        onResend={message.localStatus === "failed" ? () => onResendMessage(message.retryText ?? "") : undefined}
                        onEditMessage={message.own ? onEditMessage : undefined}
                        attachmentPreviewState={attachmentPreviewState}
                        onEnsureAttachmentPreview={onEnsureAttachmentPreview}
                        onDownloadAttachment={onDownloadAttachment}
                        attachmentOpState={attachmentOps}
                        registerRef={(messageId, el) => {
                          messageRefMap.current.set(messageId, el);
                        }}
                      />
                    </React.Fragment>
                  );
                })}
              </div>
            </div>
            {showNewMessages ? (
              <div className="px-4 pb-2">
                <button
                  type="button"
                  className="w-full rounded-lg border px-3 py-1.5 text-sm"
                  style={outlineButtonStyle}
                  onClick={jumpToLatest}
                >
                  Новые сообщения v
                </button>
              </div>
            ) : null}
            <footer className="border-t p-3 lg:p-4 space-y-2" style={{ borderColor: "var(--glass-border)", paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
              <input
                ref={attachmentInputRef}
                type="file"
                className="hidden"
                accept={chatAttachmentInputAccept}
                multiple
                onChange={(event) => {
                  onAddUpload(event.target.files);
                  event.currentTarget.value = "";
                }}
              />
              {replyTarget ? (
                <div className="rounded-lg border px-3 py-2 flex items-center justify-between gap-2" style={innerCardStyle}>
                  <div className="min-w-0">
                    <p style={{ color: "var(--base-grey-light)", fontSize: 11 }}>Ответ на сообщение</p>
                    <p className="truncate" style={{ color: "var(--text-primary)", fontSize: 12 }}>
                      {replyTarget.deletedAt ? "Сообщение удалено" : replyTarget.text || "Вложение"}
                    </p>
                  </div>
                  <button type="button" className="p-1 rounded border" style={outlineButtonStyle} onClick={onClearReply}>
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : null}
              <textarea
                data-testid="messages-composer-input"
                data-message-testid="message-input"
                value={draftText}
                onChange={(e) => onDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    onSendMessage();
                  }
                }}
                placeholder="Введите сообщение"
                className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none resize-none"
                style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)", minHeight: 68 }}
              />
              {uploads.length > 0 ? (
                <div className="space-y-2 max-h-32 overflow-auto">
                  {uploads.map((upload) => (
                    <div key={upload.id} className="flex items-center justify-between rounded-lg border px-3 py-2 interactive-surface-subtle" style={innerCardStyle}>
                      <div className="min-w-0">
                        <p className="truncate" style={{ color: "var(--text-primary)" }}>{upload.file.name}</p>
                        <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>{formatBytes(upload.file.size)}</p>
                      </div>
                      <button type="button" className="p-1 rounded border" style={outlineButtonStyle} onClick={() => onRemoveUpload(upload.id)}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  data-testid="messages-attach-button"
                  className="px-3 py-2 rounded-lg border"
                  style={outlineButtonStyle}
                  onClick={() => attachmentInputRef.current?.click()}
                >
                  <Paperclip className="w-4 h-4 inline mr-2" />
                  Вложение
                </button>
                <button
                  type="button"
                  data-testid="messages-send-button"
                  data-message-testid="send-button"
                  className="px-4 py-2 rounded-lg border"
                  style={outlineButtonStyle}
                  onClick={onSendMessage}
                >
                  <Send className="w-4 h-4 inline mr-2" />
                  Отправить
                </button>
              </div>
            </footer>
          </React.Fragment>
        )}
      </section>

      <aside className="hidden lg:block rounded-2xl border p-4 space-y-3 interactive-surface chat-panel-transition" style={cardStyle}>
        <h3 style={{ color: "var(--text-primary)", fontWeight: 600 }}>Подключение</h3>
        <TransportCard state={transportState} />
        <div className="rounded-xl border p-3" style={innerCardStyle}>
          <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>Сервер</p>
          <p style={{ color: "var(--text-primary)", wordBreak: "break-all" }}>{serverInput}</p>
        </div>
        <button
          type="button"
          data-testid="messages-reconnect-button"
          className="w-full px-3 py-2 rounded-lg border"
          style={outlineButtonStyle}
          onClick={onReconnect}
        >
          Переподключиться
        </button>
      </aside>
    </section>
  );
}

function DateSeparator({ value }: { value: string }) {
  return (
    <div className="py-2 flex justify-center">
      <span className="px-3 py-1 rounded-full border text-xs" style={innerCardStyle}>
        {formatDateLabel(value)}
      </span>
    </div>
  );
}

function isSameDay(left: string, right: string): boolean {
  const a = new Date(left);
  const b = new Date(right);
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function formatDateLabel(value: string): string {
  const source = new Date(value);
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const target = new Date(source.getFullYear(), source.getMonth(), source.getDate()).getTime();
  const dayDiff = Math.round((today - target) / (24 * 60 * 60 * 1000));
  if (dayDiff === 0) return "Сегодня";
  if (dayDiff === 1) return "Вчера";
  return source.toLocaleDateString("ru-RU", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  });
}
