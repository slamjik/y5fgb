export const MAX_CHAT_ATTACHMENT_BYTES = 20 * 1024 * 1024;
export const MAX_PROFILE_AVATAR_BYTES = 5 * 1024 * 1024;
export const MAX_PROFILE_BANNER_BYTES = 10 * 1024 * 1024;
export const MAX_SOCIAL_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_SOCIAL_VIDEO_BYTES = 64 * 1024 * 1024;
export const MAX_STORY_IMAGE_BYTES = 12 * 1024 * 1024;
export const MAX_STORY_VIDEO_BYTES = 64 * 1024 * 1024;

const imageMimeAlias: Record<string, string> = {
  "image/jpg": "image/jpeg",
};

const attachmentImageMimes = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/avif",
  "image/heic",
  "image/heif",
  "image/heic-sequence",
  "image/heif-sequence",
]);

const attachmentFileMimes = new Set<string>([
  "application/octet-stream",
  "application/pdf",
  "application/zip",
  "text/plain",
  "video/mp4",
  "video/webm",
  "video/quicktime",
  ...attachmentImageMimes,
]);

const mediaImageMimes = new Set<string>([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

const mediaVideoMimes = new Set<string>([
  "video/mp4",
  "video/webm",
  "video/quicktime",
]);

const invalidFileNameChars = /[<>:"|?*]/;
const pathChars = /[\\/]/;

export const chatAttachmentInputAccept = [
  ...Array.from(attachmentImageMimes),
  "application/pdf",
  "application/zip",
  "text/plain",
].join(",");

export const mediaImageInputAccept = Array.from(mediaImageMimes).join(",");
export const mediaVideoInputAccept = Array.from(mediaVideoMimes).join(",");

export type AttachmentUploadClassification =
  | { ok: true; kind: "image" | "file"; mimeType: string }
  | { ok: false; error: string };

export function classifyAttachmentForUpload(file: File): AttachmentUploadClassification {
  const fileNameError = validateFileName(file.name);
  if (fileNameError) {
    return { ok: false, error: fileNameError };
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, error: "Файл пустой или повреждён." };
  }
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return {
      ok: false,
      error: `Вложение слишком большое. Максимум ${toMB(MAX_CHAT_ATTACHMENT_BYTES)} МБ.`,
    };
  }

  const mimeType = normalizeMimeType(file.type);
  if (mimeType.startsWith("image/")) {
    if (!attachmentImageMimes.has(mimeType)) {
      return {
        ok: false,
        error: "Неподдерживаемый формат изображения. Используйте JPEG, PNG, WEBP, GIF, AVIF или HEIC.",
      };
    }
    return { ok: true, kind: "image", mimeType };
  }

  const effectiveMime = mimeType || "application/octet-stream";
  if (!attachmentFileMimes.has(effectiveMime)) {
    return {
      ok: false,
      error: "Этот тип файла не поддерживается для вложений.",
    };
  }
  return { ok: true, kind: "file", mimeType: effectiveMime };
}

export function validateProfileMediaFile(file: File, kind: "avatar" | "banner"): string | null {
  const fileNameError = validateFileName(file.name);
  if (fileNameError) {
    return fileNameError;
  }
  const mimeType = normalizeMimeType(file.type);
  if (!mediaImageMimes.has(mimeType)) {
    return "Для профиля можно загружать только изображения JPEG, PNG, WEBP или GIF.";
  }
  const maxBytes = kind === "avatar" ? MAX_PROFILE_AVATAR_BYTES : MAX_PROFILE_BANNER_BYTES;
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "Файл пустой или повреждён.";
  }
  if (file.size > maxBytes) {
    return `Файл слишком большой. Максимум ${toMB(maxBytes)} МБ.`;
  }
  return null;
}

export function validateStoryMediaFile(file: File): string | null {
  const fileNameError = validateFileName(file.name);
  if (fileNameError) {
    return fileNameError;
  }
  const mimeType = normalizeMimeType(file.type);
  if (mediaVideoMimes.has(mimeType)) {
    if (!Number.isFinite(file.size) || file.size <= 0) {
      return "Файл пустой или повреждён.";
    }
    if (file.size > MAX_STORY_VIDEO_BYTES) {
      return `Видео слишком большое. Максимум ${toMB(MAX_STORY_VIDEO_BYTES)} МБ.`;
    }
    return null;
  }
  if (!mediaImageMimes.has(mimeType)) {
    return "Для истории можно загрузить только изображение (JPEG/PNG/WEBP/GIF) или видео (MP4/WEBM/MOV).";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "Файл пустой или повреждён.";
  }
  if (file.size > MAX_STORY_IMAGE_BYTES) {
    return `Изображение слишком большое. Максимум ${toMB(MAX_STORY_IMAGE_BYTES)} МБ.`;
  }
  return null;
}

export function validatePostMediaFile(file: File, mediaType: "image" | "video"): string | null {
  const fileNameError = validateFileName(file.name);
  if (fileNameError) {
    return fileNameError;
  }
  const mimeType = normalizeMimeType(file.type);
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "Файл пустой или повреждён.";
  }

  if (mediaType === "image") {
    if (!mediaImageMimes.has(mimeType)) {
      return "Для поста с фото выберите JPEG, PNG, WEBP или GIF.";
    }
    if (file.size > MAX_SOCIAL_IMAGE_BYTES) {
      return `Изображение слишком большое. Максимум ${toMB(MAX_SOCIAL_IMAGE_BYTES)} МБ.`;
    }
    return null;
  }

  if (!mediaVideoMimes.has(mimeType)) {
    return "Для поста с видео выберите MP4, WEBM или MOV.";
  }
  if (file.size > MAX_SOCIAL_VIDEO_BYTES) {
    return `Видео слишком большое. Максимум ${toMB(MAX_SOCIAL_VIDEO_BYTES)} МБ.`;
  }
  return null;
}

function validateFileName(fileName: string): string | null {
  const trimmed = (fileName || "").trim();
  if (!trimmed) {
    return "Имя файла пустое.";
  }
  if (trimmed.length > 255) {
    return "Имя файла слишком длинное.";
  }
  if (pathChars.test(trimmed) || trimmed.includes("..")) {
    return "Недопустимое имя файла.";
  }
  if (invalidFileNameChars.test(trimmed)) {
    return "Имя файла содержит недопустимые символы.";
  }
  for (const symbol of trimmed) {
    const code = symbol.codePointAt(0) ?? 0;
    if ((code >= 0 && code < 32) || code === 127) {
      return "Имя файла содержит недопустимые управляющие символы.";
    }
  }
  return null;
}

function normalizeMimeType(value: string): string {
  const trimmed = (value || "").trim().toLowerCase();
  if (!trimmed) {
    return "";
  }
  const withoutParams = trimmed.split(";")[0]?.trim() ?? "";
  if (!withoutParams) {
    return "";
  }
  return imageMimeAlias[withoutParams] ?? withoutParams;
}

function toMB(value: number): number {
  return Math.max(1, Math.round(value / (1024 * 1024)));
}
