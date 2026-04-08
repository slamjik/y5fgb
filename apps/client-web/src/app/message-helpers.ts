import type { AttachmentMetaDTO, AttachmentUploadRequest, ConversationDTO, MessageDTO, SyncBatchDTO } from "@project/protocol";
import type React from "react";

import { webCryptoProvider, type RecipientPublicMaterial } from "../features/messaging/crypto";
import type { WebApiClient } from "../shared/api/client";
import type {
  AttachmentSecret,
  DeviceMaterial,
  MessageAttachmentView,
  MessageBucket,
  MessageView,
  SessionState,
  UploadDraft,
} from "./types";

export async function decodeMessage(
  message: MessageDTO,
  session: SessionState,
  device: DeviceMaterial | null,
): Promise<MessageView> {
  const recipient = message.envelope.recipients.find((item) => (item.recipientDeviceId as string) === session.deviceId);
  let text = "Зашифрованное сообщение";
  let attachmentSecrets: AttachmentSecret[] = [];
  if (recipient && device?.privateKey) {
    try {
      const decrypted = await webCryptoProvider.decryptMessage({
        ciphertext: message.envelope.ciphertext,
        nonce: message.envelope.nonce,
        wrappedKey: recipient.wrappedKey,
        recipientPublicKey: device.publicKey,
        recipientPrivateKey: device.privateKey,
      });
      const parsed = parsePlaintextPayload(decrypted);
      text = parsed.text || "";
      attachmentSecrets = parsed.attachments;
    } catch {
      text = "Не удалось расшифровать сообщение";
    }
  }

  const attachments = mapMessageAttachments(message.envelope.attachments, attachmentSecrets);

  return {
    id: message.envelope.id as string,
    conversationId: message.envelope.conversationId as string,
    senderAccountId: message.envelope.senderAccountId as string,
    createdAt: message.envelope.createdAt as string,
    serverSequence: message.envelope.serverSequence,
    text,
    attachments,
    own: (message.envelope.senderAccountId as string) === session.accountId,
    deliveryState: message.deliveryState,
  };
}

export function collectRecipients(members: ConversationDTO["members"]): RecipientPublicMaterial[] {
  const result: RecipientPublicMaterial[] = [];
  for (const member of members) {
    if (!member.isActive) continue;
    for (const device of member.trustedDevices) {
      result.push({ recipientDeviceId: device.id as string, publicKey: device.publicDeviceMaterial });
    }
  }
  return result;
}

export async function applySyncBatch(
  batch: SyncBatchDTO,
  session: SessionState,
  device: DeviceMaterial | null,
  activeConversationId: string | null,
  setMessages: React.Dispatch<React.SetStateAction<Record<string, MessageBucket>>>,
  setUnread: React.Dispatch<React.SetStateAction<Record<string, number>>>,
) {
  const mapped: MessageView[] = [];
  for (const event of batch.events) {
    if (event.type === "message" && event.message) {
      mapped.push(await decodeMessage(event.message, session, device));
    }
  }

  if (mapped.length === 0) return;

  setMessages((current) => {
    const next = { ...current };
    for (const item of mapped) {
      const bucket = next[item.conversationId] ?? { loading: false, error: "", items: [] };
      next[item.conversationId] = {
        ...bucket,
        items: upsertMessageItems(bucket.items, [item]),
      };
    }
    if (activeConversationId && next[activeConversationId]) {
      next[activeConversationId].error = "";
    }
    return next;
  });

  setUnread((current) => {
    const next = { ...current };
    for (const item of mapped) {
      if (item.own) {
        continue;
      }
      if (activeConversationId && item.conversationId === activeConversationId) {
        next[item.conversationId] = 0;
        continue;
      }
      next[item.conversationId] = (next[item.conversationId] ?? 0) + 1;
    }
    return next;
  });
}

export function parsePlaintextPayload(plaintext: string): { text: string; attachments: AttachmentSecret[] } {
  try {
    const parsed = JSON.parse(plaintext) as { text?: unknown; attachments?: unknown };
    const text = typeof parsed.text === "string" ? parsed.text : "";
    const attachments = Array.isArray(parsed.attachments)
      ? parsed.attachments
          .map((item) => normalizeAttachmentSecret(item))
          .filter((item): item is AttachmentSecret => item !== null)
      : [];
    return { text, attachments };
  } catch {
    return { text: plaintext, attachments: [] };
  }
}

export function normalizeAttachmentSecret(value: unknown): AttachmentSecret | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const source = value as Record<string, unknown>;
  const attachmentId = String(source.attachmentId ?? "").trim();
  const fileName = String(source.fileName ?? "").trim();
  const mimeType = String(source.mimeType ?? "").trim();
  const nonce = String(source.nonce ?? "").trim();
  const symmetricKey = String(source.symmetricKey ?? "").trim();
  const checksumSha256 = String(source.checksumSha256 ?? "").trim();
  const algorithm = String(source.algorithm ?? "xchacha20poly1305_ietf").trim();
  const sizeBytesRaw = Number(source.sizeBytes ?? 0);
  if (!attachmentId || !fileName || !mimeType || !nonce || !symmetricKey) {
    return null;
  }
  return {
    attachmentId,
    fileName,
    mimeType,
    sizeBytes: Number.isFinite(sizeBytesRaw) ? Math.max(0, Math.floor(sizeBytesRaw)) : 0,
    symmetricKey,
    nonce,
    checksumSha256,
    algorithm,
  };
}

export function mapMessageAttachments(
  attachments: AttachmentMetaDTO[] | undefined,
  secrets: AttachmentSecret[],
): MessageAttachmentView[] {
  if (!attachments || attachments.length === 0) {
    return [];
  }
  const secretByID = new Map(secrets.map((item) => [item.attachmentId, item]));
  return attachments.map((attachment) => {
    const id = attachment.id as string;
    const secret = secretByID.get(id);
    return {
      id,
      kind: attachment.kind,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      checksumSha256: attachment.checksumSha256,
      algorithm: attachment.encryption.algorithm,
      nonce: secret?.nonce ?? attachment.encryption.nonce,
      symmetricKey: secret?.symmetricKey ?? null,
    };
  });
}

export function applyOwnMessageFallback(
  message: MessageView,
  fallbackText: string,
  envelopeAttachments: AttachmentMetaDTO[] | undefined,
  attachmentSecrets: AttachmentSecret[],
): MessageView {
  if (!message.own) {
    return message;
  }

  if (!isEncryptedPlaceholderText(message.text)) {
    return message;
  }

  return {
    ...message,
    text: fallbackText,
    attachments: mapMessageAttachments(envelopeAttachments, attachmentSecrets),
  };
}

export function upsertMessageItems(current: MessageView[], incoming: MessageView[]): MessageView[] {
  const byID = new Map<string, MessageView>();
  for (const item of current) {
    byID.set(item.id, item);
  }
  for (const item of incoming) {
    const existing = byID.get(item.id);
    byID.set(item.id, mergeMessageView(existing, item));
  }
  return Array.from(byID.values()).sort((left, right) => left.serverSequence - right.serverSequence);
}

export function mergeMessageView(existing: MessageView | undefined, incoming: MessageView): MessageView {
  if (!existing) {
    return incoming;
  }

  const merged: MessageView = {
    ...existing,
    ...incoming,
  };

  if (isEncryptedPlaceholderText(incoming.text) && !isEncryptedPlaceholderText(existing.text)) {
    merged.text = existing.text;
    if (existing.attachments.length > 0) {
      merged.attachments = existing.attachments;
    }
  }

  return merged;
}

export function isEncryptedPlaceholderText(value: string): boolean {
  const normalized = value.trim();
  return normalized === "Зашифрованное сообщение" || normalized === "Не удалось расшифровать сообщение";
}

export async function uploadEncryptedAttachments(
  api: WebApiClient,
  accessToken: string,
  uploads: UploadDraft[],
): Promise<AttachmentSecret[]> {
  const result: AttachmentSecret[] = [];
  for (const item of uploads) {
    const bytes = new Uint8Array(await item.file.arrayBuffer());
    const encrypted = await webCryptoProvider.encryptAttachment(bytes);
    const ciphertextBytes = base64ToBytes(encrypted.ciphertext);
    const payload: AttachmentUploadRequest = {
      kind: item.file.type.startsWith("image/") ? "image" : "file",
      fileName: item.file.name,
      mimeType: item.file.type || "application/octet-stream",
      sizeBytes: ciphertextBytes.byteLength,
      checksumSha256: encrypted.checksumSha256,
      algorithm: encrypted.algorithm,
      nonce: encrypted.nonce,
      ciphertext: encrypted.ciphertext,
    };
    const response = await api.uploadAttachment(accessToken, payload);
    result.push({
      attachmentId: response.attachment.id as string,
      fileName: response.attachment.fileName,
      mimeType: response.attachment.mimeType,
      sizeBytes: response.attachment.sizeBytes,
      symmetricKey: encrypted.symmetricKey,
      nonce: encrypted.nonce,
      checksumSha256: encrypted.checksumSha256,
      algorithm: encrypted.algorithm,
    });
  }
  return result;
}

export function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const result = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    result[index] = binary.charCodeAt(index);
  }
  return result;
}

