import type { ConversationDTO, MessageDTO, SendMessageRequest } from "@project/protocol";
import { invoke } from "@tauri-apps/api/core";

import { cryptoProvider } from "@/services/messaging/cryptoProvider";
import { secureStorage } from "@/services/secureStorage";

const STORE_KEY_ID = "messaging.store.key.v1";

interface EncryptedBlob {
  nonce: string;
  ciphertext: string;
}

export interface OutboxItem {
  clientMessageId: string;
  conversationId: string;
  payload: SendMessageRequest;
  createdAt: string;
  retryCount: number;
}

let cachedStoreKey: string | null = null;

async function getStoreKey() {
  if (cachedStoreKey) {
    return cachedStoreKey;
  }

  let value = await secureStorage.getStrict(STORE_KEY_ID);
  if (!value) {
    value = await cryptoProvider.randomSymmetricKey();
    await secureStorage.setStrict(STORE_KEY_ID, value);
  }
  cachedStoreKey = value;
  return value;
}

async function encryptPayload(payload: unknown): Promise<string> {
  const storeKey = await getStoreKey();
  const encrypted = await cryptoProvider.encryptWithSymmetricKey(JSON.stringify(payload), storeKey);
  return JSON.stringify(encrypted);
}

async function decryptPayload<T>(value: string): Promise<T> {
  const storeKey = await getStoreKey();
  const encrypted = JSON.parse(value) as EncryptedBlob;
  const plaintext = await cryptoProvider.decryptWithSymmetricKey(encrypted.ciphertext, encrypted.nonce, storeKey);
  return JSON.parse(plaintext) as T;
}

export const localEncryptedStore = {
  async saveConversation(conversation: ConversationDTO): Promise<void> {
    const payload = await encryptPayload(conversation);
    await invoke("messaging_store_upsert_conversation", {
      conversation_id: conversation.id,
      payload,
      updated_at: conversation.updatedAt,
    });
  },

  async listConversations(): Promise<ConversationDTO[]> {
    const rows = await invoke<string[]>("messaging_store_list_conversations");
    const result: ConversationDTO[] = [];
    for (const row of rows) {
      result.push(await decryptPayload<ConversationDTO>(row));
    }
    return result;
  },

  async saveMessage(message: MessageDTO): Promise<void> {
    const payload = await encryptPayload(message);
    await invoke("messaging_store_upsert_message", {
      message_id: message.envelope.id,
      conversation_id: message.envelope.conversationId,
      server_sequence: message.envelope.serverSequence,
      payload,
      created_at: message.envelope.createdAt,
    });
  },

  async listMessages(conversationId: string, limit = 200): Promise<MessageDTO[]> {
    const rows = await invoke<string[]>("messaging_store_list_messages", {
      conversation_id: conversationId,
      limit,
    });
    const result: MessageDTO[] = [];
    for (const row of rows) {
      result.push(await decryptPayload<MessageDTO>(row));
    }
    return result;
  },

  async enqueueOutbox(item: { clientMessageId: string; conversationId: string; payload: SendMessageRequest; createdAt: string }): Promise<void> {
    const encryptedPayload = await encryptPayload(item.payload);
    await invoke("messaging_store_enqueue_outbox", {
      client_message_id: item.clientMessageId,
      conversation_id: item.conversationId,
      payload: encryptedPayload,
      created_at: item.createdAt,
    });
  },

  async listOutbox(): Promise<OutboxItem[]> {
    const rows = await invoke<
      Array<{
        client_message_id: string;
        conversation_id: string;
        payload: string;
        created_at: string;
        retry_count: number;
      }>
    >("messaging_store_list_outbox");

    const result: OutboxItem[] = [];
    for (const row of rows) {
      result.push({
        clientMessageId: row.client_message_id,
        conversationId: row.conversation_id,
        payload: await decryptPayload<SendMessageRequest>(row.payload),
        createdAt: row.created_at,
        retryCount: row.retry_count,
      });
    }
    return result;
  },

  async deleteOutbox(clientMessageId: string): Promise<void> {
    await invoke("messaging_store_delete_outbox", { client_message_id: clientMessageId });
  },

  async incrementOutboxRetry(clientMessageId: string): Promise<void> {
    await invoke("messaging_store_increment_outbox_retry", { client_message_id: clientMessageId });
  },

  async readSyncCursor(): Promise<number> {
    return invoke<number>("messaging_store_read_sync_cursor");
  },

  async writeSyncCursor(cursor: number): Promise<void> {
    await invoke("messaging_store_write_sync_cursor", {
      cursor,
      updated_at: new Date().toISOString(),
    });
  },
};
