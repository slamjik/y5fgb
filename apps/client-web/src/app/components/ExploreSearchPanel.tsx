import type { ProfileDTO, SocialPostDTO } from "@project/protocol";
import { Search } from "lucide-react";

import { PostCard } from "./PostCard";

interface ExploreSearchPanelProps {
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  hasSearched: boolean;
  users: ProfileDTO[];
  posts: SocialPostDTO[];
  accessToken: string;
  onOpenProfile: (accountId: string) => Promise<void>;
  onCreateDirect: (accountId: string) => Promise<void>;
  onSendFriendRequest: (accountId: string) => Promise<void>;
  onToggleLike: (postId: string, likedByMe: boolean) => Promise<void>;
  onDeletePost: (postId: string) => Promise<void>;
}

export function ExploreSearchPanel({
  query,
  onQueryChange,
  onSubmit,
  loading,
  hasSearched,
  users,
  posts,
  accessToken,
  onOpenProfile,
  onCreateDirect,
  onSendFriendRequest,
  onToggleLike,
  onDeletePost,
}: ExploreSearchPanelProps) {
  return (
    <section className="space-y-4">
      <div className="rounded-2xl border p-4 space-y-3" style={panelStyle}>
        <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Поиск людей и публикаций</p>
        <div className="flex gap-2">
          <input
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                onSubmit();
              }
            }}
            placeholder="Введите @username, имя или текст публикации"
            className="w-full rounded-lg border bg-transparent px-3 py-2 outline-none"
            style={{ borderColor: "var(--glass-border)", color: "var(--text-primary)" }}
          />
          <button type="button" className="px-3 py-2 rounded-lg border" style={outlineButtonStyle} onClick={onSubmit}>
            <Search className="w-4 h-4 inline mr-2" />
            Найти
          </button>
        </div>
      </div>

      {loading ? <StateCard text="Ищем результаты..." /> : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border p-4 space-y-3" style={panelStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Люди</p>
          {!hasSearched ? <StateCard text="Введите запрос, чтобы найти пользователей." /> : null}
          {hasSearched && !loading && users.length === 0 ? <StateCard text="Пользователи не найдены." /> : null}
          {users.map((item) => (
            <div key={item.accountId as string} className="rounded-xl border p-3 space-y-2" style={innerPanelStyle}>
              <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>
                {item.displayName || item.username || "Пользователь"}
              </p>
              <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>@{item.username}</p>
              <p style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
                Статус дружбы: {renderFriendState(item.friendState)}
              </p>
              <div className="flex gap-2 flex-wrap">
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border text-sm"
                  style={outlineButtonStyle}
                  onClick={() => void onCreateDirect(item.accountId as string)}
                >
                  Написать
                </button>
                <button
                  type="button"
                  className="px-3 py-1.5 rounded-lg border text-sm"
                  style={outlineButtonStyle}
                  onClick={() => void onOpenProfile(item.accountId as string)}
                >
                  Профиль
                </button>
                {item.friendState === "none" && item.canSendFriendRequest ? (
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-lg border text-sm"
                    style={outlineButtonStyle}
                    onClick={() => void onSendFriendRequest(item.accountId as string)}
                  >
                    Добавить
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-2xl border p-4 space-y-3" style={panelStyle}>
          <p style={{ color: "var(--text-primary)", fontWeight: 600 }}>Публикации</p>
          {!hasSearched ? <StateCard text="Введите запрос для публикаций." /> : null}
          {hasSearched && !loading && posts.length === 0 ? <StateCard text="Публикации не найдены." /> : null}
          {posts.map((post) => (
            <PostCard
              key={post.id as string}
              id={post.id as string}
              authorDisplayName={post.authorDisplayName || post.authorUsername || post.authorEmail}
              authorUsername={post.authorUsername}
              timestamp={new Date(post.createdAt as string).toLocaleString("ru-RU")}
              imageUrl={post.mediaType === "image" ? post.mediaUrl : null}
              videoUrl={post.mediaType === "video" ? post.mediaUrl : null}
              media={post.media ? { contentUrl: post.media.contentUrl, mimeType: post.media.mimeType } : null}
              accessToken={accessToken}
              caption={post.content}
              likes={post.likeCount}
              likedByMe={post.likedByMe}
              mood={post.mood}
              canDelete={post.canDelete}
              onToggleLike={onToggleLike}
              onDelete={onDeletePost}
              onOpenAuthor={() => void onOpenProfile(post.authorAccountId as string)}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

function StateCard({ text }: { text: string }) {
  return (
    <div className="rounded-xl border px-3 py-2" style={innerPanelStyle}>
      <p style={{ color: "var(--text-primary)" }}>{text}</p>
    </div>
  );
}

function renderFriendState(value: string): string {
  if (value === "friends") return "друзья";
  if (value === "incoming_request") return "входящая заявка";
  if (value === "outgoing_request") return "исходящая заявка";
  if (value === "blocked") return "заблокирован";
  return "нет связи";
}

const panelStyle: React.CSSProperties = {
  backgroundColor: "var(--glass-fill-base)",
  borderColor: "var(--glass-border)",
};

const innerPanelStyle: React.CSSProperties = {
  backgroundColor: "rgba(20, 20, 20, 0.52)",
  borderColor: "var(--glass-border)",
};

const outlineButtonStyle: React.CSSProperties = {
  borderColor: "var(--accent-brown)",
  color: "var(--accent-brown)",
};

