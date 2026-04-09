import type { SocialPostDTO } from "@project/protocol";

import { PostCard } from "./PostCard";

interface ProfilePostsSectionProps {
  posts: SocialPostDTO[];
  loading: boolean;
  error: string;
  accessToken: string;
  onOpenProfile: (accountId: string) => Promise<void>;
  onToggleLike: (postId: string, likedByMe: boolean) => Promise<void>;
  onDelete: (postId: string) => Promise<void>;
  title?: string;
}

export function ProfilePostsSection({
  posts,
  loading,
  error,
  accessToken,
  onOpenProfile,
  onToggleLike,
  onDelete,
  title = "Публикации",
}: ProfilePostsSectionProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 700 }}>{title}</h3>
        <p style={{ color: "var(--base-grey-light)" }}>Посты профиля</p>
      </div>

      {loading ? (
        <WallState text="Загружаем публикации..." />
      ) : error ? (
        <WallState text={error} tone="error" />
      ) : posts.length === 0 ? (
        <WallState text="Публикаций пока нет." />
      ) : (
        <div className="space-y-4">
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
              onDelete={onDelete}
              onOpenAuthor={() => void onOpenProfile(post.authorAccountId as string)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WallState({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "error";
}) {
  return (
    <div
      className="rounded-2xl border p-4 interactive-surface-subtle"
      style={{
        backgroundColor: "var(--glass-fill-base)",
        borderColor: "var(--glass-border)",
      }}
    >
      <p style={{ color: tone === "error" ? "#fca5a5" : "var(--text-primary)" }}>{text}</p>
    </div>
  );
}

