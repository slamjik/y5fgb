import { Image, Smile, Upload, Video } from "lucide-react";
import * as React from "react";

export type ComposerMediaType = "image" | "video";

export interface CreatePostPayload {
  content: string;
  mediaType?: ComposerMediaType;
  mediaUrl?: string;
  mediaFile?: File;
  mood?: string;
}

export type CreatePostUploadStatus = {
  phase: "idle" | "uploading" | "success" | "error";
  percent: number;
  message: string;
};

interface CreatePostProps {
  onSubmit: (payload: CreatePostPayload) => Promise<void>;
  disabled?: boolean;
  uploadStatus?: CreatePostUploadStatus;
}

const moodOptions = ["Радость", "Вдохновение", "Спокойствие", "Идея", "Фокус"];
const maxMediaSizeBytes = 25 * 1024 * 1024;

export function CreatePost({ onSubmit, disabled = false, uploadStatus }: CreatePostProps) {
  const [postText, setPostText] = React.useState("");
  const [mediaType, setMediaType] = React.useState<ComposerMediaType | null>(null);
  const [mediaUrl, setMediaUrl] = React.useState("");
  const [mediaFile, setMediaFile] = React.useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null);
  const [showLegacyUrlInput, setShowLegacyUrlInput] = React.useState(false);
  const [mood, setMood] = React.useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement | null>(null);

  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
    };
  }, [previewUrl]);

  const submitDisabled = disabled || isSubmitting || postText.trim().length === 0;

  const onFileChange = (files: FileList | null) => {
    const file = files?.[0] ?? null;
    if (!file) return;

    if (file.size > maxMediaSizeBytes) {
      setError("Файл слишком большой. Максимум 25 МБ.");
      return;
    }

    if (mediaType === "image" && !file.type.startsWith("image/")) {
      setError("Для фото выберите изображение.");
      return;
    }

    if (mediaType === "video" && !file.type.startsWith("video/")) {
      setError("Для видео выберите видеофайл.");
      return;
    }

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }

    setError(null);
    setMediaUrl("");
    setMediaFile(file);
    setPreviewUrl(URL.createObjectURL(file));
  };

  const resetMedia = () => {
    if (previewUrl) {
      URL.revokeObjectURL(previewUrl);
    }
    setPreviewUrl(null);
    setMediaFile(null);
    setMediaUrl("");
  };

  const handleSubmit = async () => {
    if (submitDisabled) {
      return;
    }

    if (mediaType && !mediaFile && !mediaUrl.trim()) {
      setError("Добавьте файл или укажите ссылку на медиа.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      await onSubmit({
        content: postText.trim(),
        mediaType: mediaType ?? undefined,
        mediaUrl: mediaFile ? undefined : mediaUrl.trim() || undefined,
        mediaFile: mediaFile ?? undefined,
        mood: mood ?? undefined,
      });

      setPostText("");
      setMediaType(null);
      setMediaUrl("");
      setMediaFile(null);
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl);
      }
      setPreviewUrl(null);
      setMood(null);
      setShowLegacyUrlInput(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Не удалось опубликовать пост.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const uploadColor =
    uploadStatus?.phase === "error"
      ? "#fca5a5"
      : uploadStatus?.phase === "success"
        ? "#86efac"
        : "var(--accent-brown)";

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
          onClick={() => {
            setMediaType((current) => (current === "image" ? null : "image"));
            setError(null);
            resetMedia();
          }}
        />
        <ActionButton
          active={mediaType === "video"}
          icon={<Video className="w-5 h-5" />}
          label="Видео"
          onClick={() => {
            setMediaType((current) => (current === "video" ? null : "video"));
            setError(null);
            resetMedia();
          }}
        />
        <ActionButton
          active={mood !== null}
          icon={<Smile className="w-5 h-5" />}
          label="Настроение"
          onClick={() => setMood((current) => (current === null ? moodOptions[0] : null))}
        />
      </div>

      {mediaType !== null ? (
        <div className="mt-3 space-y-3">
          <input
            ref={fileInputRef}
            type="file"
            accept={mediaType === "image" ? "image/*" : "video/*"}
            className="hidden"
            onChange={(event) => {
              onFileChange(event.target.files);
              event.currentTarget.value = "";
            }}
          />
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="px-4 py-2 rounded-lg border"
              style={{
                borderColor: "var(--accent-brown)",
                color: "var(--accent-brown)",
              }}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="w-4 h-4 inline mr-2" />
              Загрузить {mediaType === "image" ? "фото" : "видео"}
            </button>
            <button
              type="button"
              className="px-4 py-2 rounded-lg border text-sm"
              style={{
                borderColor: "var(--glass-border)",
                color: "var(--base-grey-light)",
              }}
              onClick={() => setShowLegacyUrlInput((current) => !current)}
            >
              {showLegacyUrlInput ? "Скрыть URL" : "Использовать URL"}
            </button>
          </div>

          {mediaFile ? (
            <div
              className="rounded-xl border p-3"
              style={{
                backgroundColor: "rgba(20, 20, 20, 0.52)",
                borderColor: "var(--glass-border)",
              }}
            >
              <p className="text-sm mb-2" style={{ color: "var(--text-primary)" }}>
                {mediaFile.name}
              </p>
              {previewUrl && mediaType === "image" ? (
                <img src={previewUrl} alt="Предпросмотр" className="w-full max-h-80 object-cover rounded-lg" />
              ) : null}
              {previewUrl && mediaType === "video" ? (
                <video src={previewUrl} className="w-full max-h-80 rounded-lg" controls />
              ) : null}
              <button
                type="button"
                className="mt-3 px-3 py-1.5 rounded-lg border text-sm"
                style={{ borderColor: "var(--glass-border)", color: "var(--base-grey-light)" }}
                onClick={resetMedia}
              >
                Убрать файл
              </button>
            </div>
          ) : null}

          {showLegacyUrlInput ? (
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
          ) : null}
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

      {uploadStatus && uploadStatus.phase !== "idle" ? (
        <div
          className="mt-3 rounded-xl border px-3 py-2 space-y-2"
          style={{ backgroundColor: "rgba(20, 20, 20, 0.52)", borderColor: "var(--glass-border)" }}
        >
          <div className="flex items-center justify-between text-xs">
            <span style={{ color: "var(--base-grey-light)" }}>Загрузка медиа</span>
            <span style={{ color: uploadColor }}>
              {uploadStatus.phase === "uploading"
                ? `${Math.max(0, Math.min(100, Math.round(uploadStatus.percent)))}%`
                : uploadStatus.phase === "success"
                  ? "Успешно"
                  : "Ошибка"}
            </span>
          </div>
          <div className="h-1.5 rounded-full" style={{ backgroundColor: "rgba(255,255,255,0.09)" }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${
                  uploadStatus.phase === "uploading"
                    ? Math.max(0, Math.min(100, Math.round(uploadStatus.percent)))
                    : uploadStatus.phase === "success"
                      ? 100
                      : Math.max(12, Math.max(0, Math.min(100, Math.round(uploadStatus.percent))))
                }%`,
                backgroundColor: uploadColor,
                opacity: uploadStatus.phase === "error" ? 0.65 : 1,
              }}
            />
          </div>
          <p className="text-sm" style={{ color: uploadColor }}>
            {uploadStatus.message}
          </p>
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

