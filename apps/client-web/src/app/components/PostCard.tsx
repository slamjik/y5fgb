import { Heart, MoreHorizontal, Trash2, UserRound } from "lucide-react";
import * as React from "react";

interface PostCardProps {
  id: string;
  authorDisplayName: string;
  authorUsername?: string;
  timestamp: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  media?: {
    contentUrl: string;
    mimeType: string;
  } | null;
  accessToken?: string;
  caption: string;
  likes: number;
  likedByMe: boolean;
  mood?: string | null;
  canDelete: boolean;
  onToggleLike: (postId: string, likedByMe: boolean) => Promise<void>;
  onDelete: (postId: string) => Promise<void>;
  onOpenAuthor?: () => void;
}

export function PostCard({
  id,
  authorDisplayName,
  authorUsername,
  timestamp,
  imageUrl,
  videoUrl,
  media,
  accessToken,
  caption,
  likes,
  likedByMe,
  mood,
  canDelete,
  onToggleLike,
  onDelete,
  onOpenAuthor,
}: PostCardProps) {
  const [likeState, setLikeState] = React.useState(likedByMe);
  const [likeCount, setLikeCount] = React.useState(likes);
  const [isDeleting, setIsDeleting] = React.useState(false);
  const [isMenuOpen, setIsMenuOpen] = React.useState(false);

  React.useEffect(() => {
    setLikeState(likedByMe);
  }, [likedByMe]);

  React.useEffect(() => {
    setLikeCount(likes);
  }, [likes]);

  const handleLike = async () => {
    const next = !likeState;
    setLikeState(next);
    setLikeCount((current) => Math.max(0, current + (next ? 1 : -1)));
    try {
      await onToggleLike(id, likeState);
    } catch {
      setLikeState(!next);
      setLikeCount((current) => Math.max(0, current + (next ? -1 : 1)));
    }
  };

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      await onDelete(id);
    } finally {
      setIsDeleting(false);
      setIsMenuOpen(false);
    }
  };

  return (
    <article
      className="rounded-2xl p-5 border transition-all"
      style={{
        backgroundColor: "var(--glass-fill-base)",
        borderColor: "var(--glass-border)",
        backdropFilter: "blur(20px)",
      }}
    >
      <header className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            className="w-10 h-10 rounded-full flex items-center justify-center border"
            style={{
              background: "rgba(12,12,12,0.45)",
              borderColor: "var(--glass-border)",
              color: "var(--accent-brown)",
            }}
            onClick={onOpenAuthor}
          >
            <UserRound className="w-5 h-5" />
          </button>
          <div>
            <button
              type="button"
              style={{ color: "var(--accent-brown)", fontWeight: 600 }}
              onClick={onOpenAuthor}
              className="text-left"
            >
              {authorDisplayName || "Пользователь"}
            </button>
            <div className="text-xs" style={{ color: "var(--base-grey-light)" }}>
              {authorUsername ? `@${authorUsername} · ` : ""}
              {timestamp}
            </div>
          </div>
        </div>

        {canDelete ? (
          <div className="relative">
            <button
              type="button"
              className="p-2 rounded-lg transition-colors"
              style={{ color: "var(--base-grey-light)" }}
              onClick={() => setIsMenuOpen((current) => !current)}
            >
              <MoreHorizontal className="w-5 h-5" />
            </button>
            {isMenuOpen ? (
              <div
                className="absolute right-0 mt-1 rounded-lg border p-1"
                style={{
                  backgroundColor: "var(--glass-fill-hover)",
                  borderColor: "var(--glass-border)",
                  minWidth: 150,
                }}
              >
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={isDeleting}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all"
                  style={{ color: "#fda4af" }}
                >
                  <Trash2 className="w-4 h-4" />
                  {isDeleting ? "Удаляем..." : "Удалить пост"}
                </button>
              </div>
            ) : null}
          </div>
        ) : null}
      </header>

      {media ? (
        <ProtectedMedia
          contentUrl={media.contentUrl}
          mimeType={media.mimeType}
          accessToken={accessToken}
        />
      ) : imageUrl ? (
        <MediaContainer>
          <img src={imageUrl} alt="Изображение поста" className="w-full h-80 object-cover rounded-lg" loading="lazy" />
        </MediaContainer>
      ) : videoUrl ? (
        <MediaContainer>
          <video controls className="w-full h-80 object-cover rounded-lg" src={videoUrl} preload="metadata" />
        </MediaContainer>
      ) : null}

      {mood ? (
        <div className="mb-3 text-sm" style={{ color: "var(--accent-brown)" }}>
          Настроение: {mood}
        </div>
      ) : null}

      <p className="mb-4 whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>
        {caption}
      </p>

      <button
        type="button"
        className="flex items-center gap-2 transition-colors"
        style={{ color: likeState ? "var(--accent-brown)" : "var(--base-grey-light)" }}
        onClick={handleLike}
      >
        <Heart className="w-5 h-5" fill={likeState ? "var(--accent-brown)" : "none"} />
        <span className="text-xs" style={{ color: "var(--base-grey-light)" }}>
          {likeCount}
        </span>
      </button>
    </article>
  );
}

function ProtectedMedia({
  contentUrl,
  mimeType,
  accessToken,
}: {
  contentUrl: string;
  mimeType: string;
  accessToken?: string;
}) {
  const [blobUrl, setBlobUrl] = React.useState<string | null>(null);
  const [error, setError] = React.useState("");
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let disposed = false;
    let currentUrl: string | null = null;
    const load = async () => {
      setLoading(true);
      setError("");
      try {
        const response = await fetch(contentUrl, {
          method: "GET",
          headers: {
            ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
          },
        });
        if (!response.ok) {
          throw new Error("Не удалось загрузить медиа.");
        }
        const blob = await response.blob();
        currentUrl = URL.createObjectURL(blob);
        if (!disposed) {
          setBlobUrl(currentUrl);
        }
      } catch (loadError) {
        if (!disposed) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить медиа.");
        }
      } finally {
        if (!disposed) {
          setLoading(false);
        }
      }
    };

    void load();

    return () => {
      disposed = true;
      if (currentUrl) {
        URL.revokeObjectURL(currentUrl);
      }
    };
  }, [accessToken, contentUrl]);

  if (loading) {
    return (
      <MediaContainer>
        <div className="h-52 flex items-center justify-center" style={{ color: "var(--base-grey-light)" }}>
          Загружаем медиа...
        </div>
      </MediaContainer>
    );
  }

  if (error || !blobUrl) {
    return (
      <MediaContainer>
        <div className="h-52 flex items-center justify-center" style={{ color: "#fca5a5" }}>
          {error || "Медиа недоступно"}
        </div>
      </MediaContainer>
    );
  }

  if (mimeType.startsWith("video/")) {
    return (
      <MediaContainer>
        <video controls className="w-full h-80 object-cover rounded-lg" src={blobUrl} preload="metadata" />
      </MediaContainer>
    );
  }

  return (
    <MediaContainer>
      <img src={blobUrl} alt="Изображение поста" className="w-full h-80 object-cover rounded-lg" loading="lazy" />
    </MediaContainer>
  );
}

function MediaContainer({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-lg overflow-hidden mb-4"
      style={{
        padding: "8px",
        backgroundColor: "rgba(0, 0, 0, 0.3)",
      }}
    >
      {children}
    </div>
  );
}
