import { Heart, MoreHorizontal, Trash2 } from "lucide-react";
import * as React from "react";

interface PostCardProps {
  id: string;
  username: string;
  timestamp: string;
  imageUrl?: string | null;
  videoUrl?: string | null;
  caption: string;
  likes: number;
  likedByMe: boolean;
  mood?: string | null;
  canDelete: boolean;
  onToggleLike: (postId: string, likedByMe: boolean) => Promise<void>;
  onDelete: (postId: string) => Promise<void>;
}

export function PostCard({
  id,
  username,
  timestamp,
  imageUrl,
  videoUrl,
  caption,
  likes,
  likedByMe,
  mood,
  canDelete,
  onToggleLike,
  onDelete,
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
    <div
      className="rounded-2xl p-5 border transition-all"
      style={{
        backgroundColor: "var(--glass-fill-base)",
        borderColor: "var(--glass-border)",
        backdropFilter: "blur(20px)",
      }}
    >
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <div
            className="w-10 h-10 rounded-full"
            style={{
              background: "linear-gradient(135deg, var(--accent-brown), var(--base-grey-light))",
            }}
          />
          <div>
            <div style={{ color: "var(--accent-brown)" }}>{username}</div>
            <div className="text-xs" style={{ color: "var(--base-grey-light)" }}>
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
                  minWidth: 140,
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
      </div>

      {imageUrl ? (
        <MediaContainer>
          <img src={imageUrl} alt="post" className="w-full h-80 object-cover rounded-lg" />
        </MediaContainer>
      ) : null}

      {videoUrl ? (
        <MediaContainer>
          <video controls className="w-full h-80 object-cover rounded-lg" src={videoUrl} />
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
    </div>
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
