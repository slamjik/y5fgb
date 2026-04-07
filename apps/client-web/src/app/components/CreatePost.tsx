import { Image, Smile, Video } from "lucide-react";
import * as React from "react";

export type ComposerMediaType = "image" | "video";

export interface CreatePostPayload {
  content: string;
  mediaType?: ComposerMediaType;
  mediaUrl?: string;
  mood?: string;
}

interface CreatePostProps {
  onSubmit: (payload: CreatePostPayload) => Promise<void>;
  disabled?: boolean;
}

const moodOptions = ["Радость", "Вдохновение", "Спокойствие", "Идея", "Фокус"];

export function CreatePost({ onSubmit, disabled = false }: CreatePostProps) {
  const [postText, setPostText] = React.useState("");
  const [mediaType, setMediaType] = React.useState<ComposerMediaType | null>(null);
  const [mediaUrl, setMediaUrl] = React.useState("");
  const [mood, setMood] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const submitDisabled = disabled || isSubmitting || postText.trim().length === 0;

  const handleSubmit = async () => {
    if (submitDisabled) {
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        content: postText.trim(),
        mediaType: mediaType ?? undefined,
        mediaUrl: mediaUrl.trim() || undefined,
        mood: mood ?? undefined,
      });

      setPostText("");
      setMediaType(null);
      setMediaUrl("");
      setMood(null);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось опубликовать пост.");
    } finally {
      setIsSubmitting(false);
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
      <textarea
        value={postText}
        onChange={(event) => setPostText(event.target.value)}
        placeholder="Поделитесь новостью..."
        className="w-full bg-transparent rounded-lg px-4 py-3 resize-none outline-none transition-colors border"
        style={{
          borderColor: "var(--base-grey-light)",
          color: "var(--text-primary)",
        }}
        rows={3}
      />

      <div className="flex flex-wrap gap-3 mt-4">
        <ActionButton
          active={mediaType === "image"}
          icon={<Image className="w-5 h-5" />}
          label="Фото"
          onClick={() => setMediaType((current) => (current === "image" ? null : "image"))}
        />
        <ActionButton
          active={mediaType === "video"}
          icon={<Video className="w-5 h-5" />}
          label="Видео"
          onClick={() => setMediaType((current) => (current === "video" ? null : "video"))}
        />
        <ActionButton
          active={mood !== null}
          icon={<Smile className="w-5 h-5" />}
          label="Настроение"
          onClick={() => setMood((current) => (current === null ? moodOptions[0] : null))}
        />
      </div>

      {mediaType !== null ? (
        <div className="mt-3">
          <input
            type="url"
            value={mediaUrl}
            onChange={(event) => setMediaUrl(event.target.value)}
            placeholder={mediaType === "image" ? "URL фото (https://...)" : "URL видео (https://...)"}
            className="w-full bg-transparent rounded-lg px-4 py-2 outline-none transition-colors border"
            style={{
              borderColor: "var(--base-grey-light)",
              color: "var(--text-primary)",
            }}
          />
        </div>
      ) : null}

      {mood !== null ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {moodOptions.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMood(option)}
              className="px-3 py-1.5 rounded-lg text-sm transition-all border"
              style={{
                borderColor: "var(--accent-brown)",
                color: mood === option ? "var(--core-background)" : "var(--accent-brown)",
                backgroundColor: mood === option ? "var(--accent-brown)" : "transparent",
              }}
            >
              {option}
            </button>
          ))}
        </div>
      ) : null}

      {error ? (
        <p className="mt-3 text-sm" style={{ color: "#fca5a5" }}>
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitDisabled}
          className="px-5 py-2 rounded-lg border transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          style={{
            borderColor: "var(--accent-brown)",
            color: "var(--accent-brown)",
            backgroundColor: "transparent",
          }}
        >
          {isSubmitting ? "Публикуем..." : "Опубликовать"}
        </button>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  const [isHovered, setIsHovered] = React.useState(false);

  return (
    <button
      type="button"
      className="flex items-center gap-2 px-4 py-2 rounded-lg transition-all"
      style={{
        backgroundColor: active || isHovered ? "var(--glass-fill-hover)" : "transparent",
        backdropFilter: "blur(10px)",
        color: active || isHovered ? "var(--accent-brown)" : "var(--base-grey-light)",
      }}
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {icon}
      <span style={{ color: "var(--accent-brown)" }}>{label}</span>
    </button>
  );
}
