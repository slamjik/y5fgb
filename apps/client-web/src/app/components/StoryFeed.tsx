import type { StoryDTO } from "@project/protocol";
import { Clock3, Trash2 } from "lucide-react";
import * as React from "react";

import { ProfileAvatar } from "./ProfileAvatar";

interface StoryFeedProps {
  title: string;
  subtitle: string;
  stories: StoryDTO[];
  loading: boolean;
  error: string;
  emptyText: string;
  onDeleteStory: (storyId: string) => Promise<void>;
}

export function StoryFeed({
  title,
  subtitle,
  stories,
  loading,
  error,
  emptyText,
  onDeleteStory,
}: StoryFeedProps) {
  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 style={{ color: "var(--text-primary)", fontSize: 22, fontWeight: 700 }}>{title}</h3>
        <p style={{ color: "var(--base-grey-light)" }}>{subtitle}</p>
      </div>

      {loading ? (
        <FeedState text="Загружаем истории..." />
      ) : error ? (
        <FeedState text={error} tone="error" />
      ) : stories.length === 0 ? (
        <FeedState text={emptyText} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {stories.map((story) => (
            <StoryCard key={story.id as string} story={story} onDeleteStory={onDeleteStory} />
          ))}
        </div>
      )}
    </section>
  );
}

function StoryCard({
  story,
  onDeleteStory,
}: {
  story: StoryDTO;
  onDeleteStory: (storyId: string) => Promise<void>;
}) {
  const [isDeleting, setIsDeleting] = React.useState(false);

  const label = story.ownerName || story.ownerUsername || "История";
  const expiresAt = new Date(story.expiresAt as string).toLocaleString("ru-RU");

  return (
    <article
      className="rounded-2xl border p-4 space-y-4 relative overflow-hidden"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0.01))",
        borderColor: "var(--glass-border)",
        backdropFilter: "blur(18px)",
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <ProfileAvatar displayName={label} avatarColor="#3fa5ff" size={46} />
          <div className="min-w-0">
            <p className="font-medium truncate" style={{ color: "var(--text-primary)" }}>
              {label}
            </p>
            <p className="text-xs truncate" style={{ color: "var(--base-grey-light)" }}>
              История до {expiresAt}
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={async () => {
            setIsDeleting(true);
            try {
              await onDeleteStory(story.id as string);
            } finally {
              setIsDeleting(false);
            }
          }}
          disabled={isDeleting}
          className="px-3 py-2 rounded-lg border text-sm transition-all"
          style={{ borderColor: "var(--glass-border)", color: "#fda4af" }}
        >
          <Trash2 className="w-4 h-4 inline mr-1" />
          {isDeleting ? "Удаляем..." : "Удалить"}
        </button>
      </div>

      <p className="whitespace-pre-wrap break-words" style={{ color: "var(--text-primary)" }}>
        {story.caption?.trim() ? story.caption : "Без подписи"}
      </p>

      <div className="flex items-center gap-2" style={{ color: "var(--base-grey-light)", fontSize: 12 }}>
        <Clock3 className="w-4 h-4" />
        <span>Истекает {expiresAt}</span>
      </div>
    </article>
  );
}

function FeedState({
  text,
  tone = "default",
}: {
  text: string;
  tone?: "default" | "error";
}) {
  return (
    <div
      className="rounded-2xl border p-4"
      style={{
        backgroundColor: "var(--glass-fill-base)",
        borderColor: "var(--glass-border)",
      }}
    >
      <p style={{ color: tone === "error" ? "#fca5a5" : "var(--text-primary)" }}>{text}</p>
    </div>
  );
}

