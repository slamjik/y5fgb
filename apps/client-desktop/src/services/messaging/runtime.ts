import type {
  ConversationDTO,
  CreateConversationResponse,
  MessageDTO,
  SendMessageRequest,
  SyncBatchDTO,
  TransportEndpointsResponse,
} from "@project/protocol";

import { appConfig } from "@/lib/config";
import { randomID } from "@/lib/randomId";
import { loadAllDeviceKeyMaterials } from "@/services/identity";
import { logger } from "@/services/logger";
import { classifyMessagingError } from "@/services/messaging/errorModel";
import { messageLifecycleFromDeliveryState } from "@/services/messaging/lifecycle";
import { cryptoProvider } from "@/services/messaging/cryptoProvider";
import { localEncryptedStore } from "@/services/messaging/localEncryptedStore";
import { messagingApi } from "@/services/messaging/messagingApi";
import { WebSocketTransport } from "@/services/messaging/transportClients";
import { getActiveServerConfig } from "@/services/serverConnection";
import { useAuthStore } from "@/state/authStore";
import { type LocalMessage, useMessagingStore } from "@/state/messagingStore";

type UploadInput = {
  fileName: string;
  mimeType: string;
  bytes: Uint8Array;
};

type MessageAttachmentSecret = {
  attachmentId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  symmetricKey: string;
  nonce: string;
  checksumSha256: string;
  algorithm: string;
};

class MessagingRuntime {
  private accessToken: string | null = null;
  private wsTransport: WebSocketTransport | null = null;
  private longPollRunning = false;
  private reconnectTimer: number | null = null;
  private wsEndpoints: string[] = [];
  private longPollEndpoints: string[] = [];
  private wsEndpointIndex = 0;
  private longPollEndpointIndex = 0;
  private reconnectBackoffMinMs = 500;
  private reconnectBackoffMaxMs = 10_000;
  private reconnectBackoffCurrentMs = 500;
  private longPollTimeoutSec = 25;
  private longPollEnabled = true;
  private stopped = true;

  private flushOutboxRunning = false;
  private flushOutboxRequested = false;

  private syncRunning = false;
  private queuedSyncHint: number | null = null;

  async start(accessToken: string) {
    if (!this.stopped && this.accessToken === accessToken) {
      return;
    }
    if (!this.stopped) {
      this.stop();
    }

    this.accessToken = accessToken;
    this.stopped = false;

    useMessagingStore.getState().setTransportState({
      mode: "none",
      status: "connecting",
      endpoint: null,
      lastError: null,
    });

    try {
      useMessagingStore.getState().setLoading(true);
      await this.hydrateFromLocalStore();
      await this.refreshConversations();
      await this.bootstrapSync();
      await this.refreshOutbox();
      await this.flushOutbox();
      await this.configureTransport();
      this.connectWebSocket();
      this.ensureLongPollLoop();
    } catch (error) {
      this.stop();
      throw error;
    } finally {
      useMessagingStore.getState().setLoading(false);
    }
  }

  stop() {
    this.stopped = true;
    this.accessToken = null;
    this.wsEndpointIndex = 0;
    this.longPollEndpointIndex = 0;
    this.flushOutboxRunning = false;
    this.flushOutboxRequested = false;
    this.syncRunning = false;
    this.queuedSyncHint = null;

    if (this.wsTransport) {
      this.wsTransport.disconnect();
      this.wsTransport = null;
    }
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    useMessagingStore.getState().setTransportState({
      mode: "none",
      status: "offline",
      endpoint: null,
      lastError: null,
    });
  }

  async refreshConversations() {
    const accessToken = this.requireAccessToken();
    const response = await messagingApi.listConversations(accessToken);
    const conversations = response.conversations;
    for (const conversation of conversations) {
      await localEncryptedStore.saveConversation(conversation);
    }
    useMessagingStore.getState().setConversations(conversations);
  }

  async createDirect(peerAccountId: string) {
    const accessToken = this.requireAccessToken();
    const response = await messagingApi.createDirect(accessToken, { peerAccountId } as any);
    await this.persistConversation(response);
    return response.conversation;
  }

  async createGroup(title: string, memberAccountIds: string[]) {
    const accessToken = this.requireAccessToken();
    const response = await messagingApi.createGroup(accessToken, {
      title,
      memberAccountIds,
    } as any);
    await this.persistConversation(response);
    return response.conversation;
  }

  async loadMessages(conversationId: string) {
    const accessToken = this.requireAccessToken();
    useMessagingStore.getState().setActiveConversation(conversationId);

    const cached = await localEncryptedStore.listMessages(conversationId, 200);
    if (cached.length > 0) {
      const hydrated = await this.hydrateMessages(cached);
      useMessagingStore.getState().setMessages(conversationId, hydrated);
    }

    const response = await messagingApi.listMessages(accessToken, conversationId, { limit: 100 });
    const hydratedRemote = await this.hydrateMessages(response.messages);
    useMessagingStore.getState().setMessages(conversationId, hydratedRemote);
    for (const message of response.messages) {
      await localEncryptedStore.saveMessage(message);
    }
  }

  async sendMessage(input: {
    conversation: ConversationDTO;
    text: string;
    ttlSeconds?: number;
    uploads?: UploadInput[];
    replyToMessageId?: string;
  }) {
    const accessToken = this.requireAccessToken();
    const session = this.requireSession();
    const clientMessageId = randomID();
    const recipients = this.resolveRecipients(input.conversation);
    if (recipients.length === 0) {
      throw new Error("conversation has no trusted recipient devices");
    }

    const optimisticMessage = this.createOptimisticMessage({
      conversation: input.conversation,
      clientMessageId,
      text: input.text,
      ttlSeconds: input.ttlSeconds,
      replyToMessageId: input.replyToMessageId,
      senderAccountId: session.accountId,
      senderDeviceId: session.device.id,
    });
    useMessagingStore.getState().upsertMessage(input.conversation.id, optimisticMessage);

    try {
      useMessagingStore
        .getState()
        .updateMessageLifecycle(input.conversation.id, session.device.id, clientMessageId, { lifecycle: "encrypting" });

      const attachmentSecrets = await this.uploadAttachments(accessToken, input.uploads ?? []);
      const plaintextPayload = {
        text: input.text,
        attachments: attachmentSecrets,
        createdAt: new Date().toISOString(),
        replyToMessageId: input.replyToMessageId ?? null,
      };
      const encrypted = await cryptoProvider.encryptMessage(JSON.stringify(plaintextPayload), recipients);

      const sendRequest = {
        clientMessageId,
        algorithm: encrypted.algorithm,
        cryptoVersion: encrypted.cryptoVersion,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
        recipients: encrypted.recipients,
        attachmentIds: attachmentSecrets.map((item) => item.attachmentId),
        replyToMessageId: input.replyToMessageId,
        ttlSeconds: input.ttlSeconds,
      } as SendMessageRequest;

      await localEncryptedStore.enqueueOutbox({
        clientMessageId,
        conversationId: input.conversation.id,
        payload: sendRequest,
        createdAt: new Date().toISOString(),
      });

      useMessagingStore.getState().upsertMessage(input.conversation.id, {
        ...optimisticMessage,
        envelope: {
          ...optimisticMessage.envelope,
          algorithm: encrypted.algorithm,
          cryptoVersion: encrypted.cryptoVersion,
          nonce: encrypted.nonce,
          ciphertext: encrypted.ciphertext,
          recipients: encrypted.recipients as any,
          attachments: attachmentSecrets.map((secret) =>
            ({
              id: secret.attachmentId,
              kind: secret.mimeType.startsWith("image/") ? "image" : "file",
              fileName: secret.fileName,
              mimeType: secret.mimeType,
              sizeBytes: secret.sizeBytes,
              checksumSha256: secret.checksumSha256,
              encryption: {
                algorithm: secret.algorithm,
                nonce: secret.nonce,
              },
              createdAt: new Date().toISOString(),
            }) as any,
          ),
        },
        lifecycle: "queued",
        deliveryState: "queued",
        lastUpdatedAt: new Date().toISOString(),
      });

      await this.refreshOutbox();
      await this.flushOutbox();
    } catch (error) {
      const classified = classifyMessagingError(error);
      useMessagingStore.getState().updateMessageLifecycle(input.conversation.id, session.device.id, clientMessageId, {
        lifecycle: "failed",
        failureCode: classified.code,
        retryableFailure: classified.class === "retryable",
      });
      throw error;
    }
  }

  async retryOutbox() {
    await this.flushOutbox();
  }

  async downloadAttachment(input: { attachmentId: string; symmetricKey: string; nonce: string; checksumSha256?: string }) {
    const accessToken = this.requireAccessToken();
    const response = await messagingApi.downloadAttachment(accessToken, input.attachmentId);
    if (input.checksumSha256) {
      const ciphertextBytes = base64ToBytes(response.ciphertext);
      const checksum = await cryptoProvider.hashBytesHex(ciphertextBytes);
      if (checksum.toLowerCase() !== input.checksumSha256.toLowerCase()) {
        throw new Error("attachment_download_failed");
      }
    }
    const decrypted = await cryptoProvider.decryptAttachment({
      ciphertext: response.ciphertext,
      nonce: input.nonce,
      symmetricKey: input.symmetricKey,
    });
    return {
      bytes: decrypted,
      mimeType: response.attachment.mimeType,
      fileName: response.attachment.fileName,
    };
  }

  private async persistConversation(response: CreateConversationResponse) {
    await localEncryptedStore.saveConversation(response.conversation);
    useMessagingStore.getState().upsertConversation(response.conversation);
  }

  private async hydrateFromLocalStore() {
    try {
      const [conversations, outbox, cursor] = await Promise.all([
        localEncryptedStore.listConversations(),
        localEncryptedStore.listOutbox(),
        localEncryptedStore.readSyncCursor(),
      ]);
      useMessagingStore.getState().setConversations(conversations);
      useMessagingStore.getState().setOutbox(outbox);
      useMessagingStore.getState().setTransportState({ lastCursor: cursor });
    } catch (error) {
      logger.warn("failed to hydrate messaging from local secure storage", { error: String(error) });
      throw new Error("local_storage_unavailable");
    }
  }

  private async bootstrapSync() {
    const accessToken = this.requireAccessToken();
    const response = await messagingApi.syncBootstrap(accessToken, 100);
    await this.applySyncBatch(response.batch);
    useMessagingStore.getState().setInitialized(true);
  }

  private async configureTransport() {
    const accessToken = this.requireAccessToken();
    const config = await messagingApi.transportEndpoints(accessToken);
    this.applyTransportConfig(config);
  }

  private applyTransportConfig(config: TransportEndpointsResponse) {
    this.wsEndpoints = config.endpoints
      .filter((endpoint) => endpoint.enabled && endpoint.mode === "websocket")
      .map((endpoint) => endpoint.url);

    this.longPollEndpoints = config.endpoints
      .filter((endpoint) => endpoint.enabled && endpoint.mode === "long_poll")
      .map((endpoint) => endpoint.url);

    this.longPollEnabled = config.profile.longPollEnabled;
    this.longPollTimeoutSec = config.profile.longPollTimeoutSeconds;
    this.reconnectBackoffMinMs = config.profile.reconnectBackoffMinMs;
    this.reconnectBackoffMaxMs = config.profile.reconnectBackoffMaxMs;
    this.reconnectBackoffCurrentMs = this.reconnectBackoffMinMs;

    for (const overrideEndpoint of appConfig.transportEndpointOverrides) {
      if (overrideEndpoint.startsWith("ws://") || overrideEndpoint.startsWith("wss://")) {
        this.wsEndpoints.push(overrideEndpoint);
      } else if (overrideEndpoint.startsWith("http://") || overrideEndpoint.startsWith("https://")) {
        this.longPollEndpoints.push(overrideEndpoint);
      }
    }

    this.wsEndpoints = dedupeEndpoints(this.wsEndpoints);
    this.longPollEndpoints = dedupeEndpoints(this.longPollEndpoints);

    if (this.longPollEndpoints.length === 0 && this.longPollEnabled) {
      const server = getActiveServerConfig();
      this.longPollEndpoints = [`${server.apiBaseUrl}${server.apiPrefix}/sync/poll`];
    }
  }

  private connectWebSocket() {
    if (this.stopped || !this.accessToken) {
      return;
    }
    if (this.wsEndpoints.length === 0) {
      return;
    }
    if (this.wsTransport?.isConnected() || this.wsTransport?.isConnecting()) {
      return;
    }

    const endpoint = this.wsEndpoints[this.wsEndpointIndex % this.wsEndpoints.length];
    this.wsTransport = new WebSocketTransport({
      onConnected: (connectedEndpoint) => {
        this.reconnectBackoffCurrentMs = this.reconnectBackoffMinMs;
        useMessagingStore.getState().setTransportState({
          mode: "websocket",
          status: "connected",
          endpoint: connectedEndpoint,
          lastError: null,
        });
      },
      onDisconnected: (_connectedEndpoint, reason) => {
        if (this.stopped) {
          return;
        }
        this.reportWebSocketIssue(reason ?? "websocket disconnected", endpoint);
        this.ensureLongPollLoop();
        this.scheduleReconnect();
      },
      onError: (_connectedEndpoint, errorMessage) => {
        if (this.stopped) {
          return;
        }
        this.reportWebSocketIssue(errorMessage, endpoint);
      },
      onSyncAvailable: (cursor) => {
        void this.requestSync(Math.max(cursor, 0));
      },
    });

    useMessagingStore.getState().setTransportState({
      mode: "websocket",
      status: "connecting",
      endpoint,
      lastError: null,
    });
    this.wsTransport.connect(endpoint, this.accessToken);
  }

  private scheduleReconnect() {
    if (this.stopped || this.wsEndpoints.length === 0) {
      return;
    }
    if (this.reconnectTimer) {
      window.clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    const baseDelay = this.reconnectBackoffCurrentMs;
    const jitter = Math.floor(Math.random() * Math.max(10, Math.floor(baseDelay * 0.25)));
    const delay = baseDelay + jitter;

    this.reconnectBackoffCurrentMs = Math.min(this.reconnectBackoffCurrentMs * 2, this.reconnectBackoffMaxMs);
    this.wsEndpointIndex = (this.wsEndpointIndex + 1) % Math.max(this.wsEndpoints.length, 1);

    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connectWebSocket();
    }, delay);
  }

  private ensureLongPollLoop() {
    if (this.longPollRunning || this.stopped || !this.longPollEnabled) {
      return;
    }
    this.longPollRunning = true;
    void this.longPollLoop();
  }

  private async longPollLoop() {
    try {
      while (!this.stopped && this.longPollEnabled) {
        if (this.wsTransport?.isConnected()) {
          await this.sleep(900);
          continue;
        }

        const endpoint = this.resolveLongPollEndpoint();
        useMessagingStore.getState().setTransportState({
          mode: "long_poll",
          status: this.wsEndpoints.length > 0 ? "degraded" : "connected",
          endpoint,
        });

        try {
          await this.requestSync(undefined, endpoint);
          useMessagingStore.getState().setTransportState({
            mode: "long_poll",
            status: this.wsEndpoints.length > 0 ? "degraded" : "connected",
            endpoint,
            lastError: null,
          });
          await this.flushOutbox();
        } catch (error) {
          const classified = classifyMessagingError(error);
          useMessagingStore.getState().setTransportState({
            mode: "long_poll",
            status: "offline",
            endpoint,
            lastError: classified.message,
          });
          if (this.longPollEndpoints.length > 1 && classified.class === "retryable") {
            this.longPollEndpointIndex = (this.longPollEndpointIndex + 1) % this.longPollEndpoints.length;
          }
          await this.sleep(1_250);
        }
      }
    } finally {
      this.longPollRunning = false;
    }
  }

  private resolveLongPollEndpoint(): string {
    if (this.longPollEndpoints.length === 0) {
      const server = getActiveServerConfig();
      return `${server.apiBaseUrl}${server.apiPrefix}/sync/poll`;
    }
    return this.longPollEndpoints[this.longPollEndpointIndex % this.longPollEndpoints.length];
  }

  private async requestSync(cursorHint?: number, endpoint?: string) {
    const normalizedHint = typeof cursorHint === "number" && Number.isFinite(cursorHint) ? Math.floor(Math.max(cursorHint, 0)) : null;
    if (normalizedHint !== null) {
      this.queuedSyncHint = this.queuedSyncHint === null ? normalizedHint : Math.max(this.queuedSyncHint, normalizedHint);
    }

    if (this.syncRunning) {
      return;
    }

    this.syncRunning = true;
    try {
      do {
        const hint = this.queuedSyncHint;
        this.queuedSyncHint = null;
        await this.syncOnce(this.longPollTimeoutSec, hint ?? undefined, endpoint);
      } while (this.queuedSyncHint !== null);
    } finally {
      this.syncRunning = false;
    }
  }

  private async syncOnce(timeoutSec: number, cursorHint?: number, endpoint?: string) {
    const accessToken = this.requireAccessToken();
    const localCursor = await localEncryptedStore.readSyncCursor();
    const cursor = Math.max(localCursor, cursorHint ?? 0);

    const response = endpoint
      ? await messagingApi.syncPollAtEndpoint(accessToken, endpoint, cursor, timeoutSec, 100)
      : await messagingApi.syncPoll(accessToken, cursor, timeoutSec, 100);

    await this.applySyncBatch(response.batch);
  }

  private async applySyncBatch(batch: SyncBatchDTO) {
    const currentSession = useAuthStore.getState().session;
    if (!currentSession) {
      return;
    }

    for (const event of batch.events) {
      if (event.type !== "message" || !event.message) {
        continue;
      }

      const hydrated = await this.hydrateMessage(event.message);
      useMessagingStore.getState().upsertMessage(hydrated.envelope.conversationId, hydrated);
      await localEncryptedStore.saveMessage(event.message);

      if (hydrated.envelope.senderDeviceId === currentSession.device.id) {
        continue;
      }
      if (hydrated.receipts.some((receipt) => receipt.deviceId === currentSession.device.id && receipt.receiptType === "delivered")) {
        continue;
      }

      try {
        await messagingApi.createReceipt(this.requireAccessToken(), hydrated.envelope.id, { receiptType: "delivered" });
      } catch (error) {
        logger.debug("failed to create delivered receipt", {
          messageId: hydrated.envelope.id,
          error: String(error),
        });
      }
    }

    const safeCursor = Math.max(batch.toCursor, 0);
    await localEncryptedStore.writeSyncCursor(safeCursor);
    useMessagingStore.getState().setTransportState({ lastCursor: safeCursor });
  }

  private async hydrateMessages(messages: MessageDTO[]): Promise<LocalMessage[]> {
    const result: LocalMessage[] = [];
    for (const message of messages) {
      result.push(await this.hydrateMessage(message));
    }
    return result;
  }

  private async hydrateMessage(message: MessageDTO): Promise<LocalMessage> {
    const now = Date.now();
    const expiresAt = message.envelope.expiresAt ? new Date(message.envelope.expiresAt).getTime() : null;
    const expired = expiresAt !== null && expiresAt <= now;

    const localMessage: LocalMessage = {
      ...message,
      expired,
      lifecycle: messageLifecycleFromDeliveryState(message.deliveryState, expired),
      lastUpdatedAt: new Date().toISOString(),
    };

    if (expired) {
      return localMessage;
    }

    const session = useAuthStore.getState().session;
    if (!session) {
      return localMessage;
    }

    try {
      const currentDeviceID = String(session.device.id);
      const recipient = message.envelope.recipients.find((item) => String(item.recipientDeviceId) === currentDeviceID);
      if (!recipient) {
        return {
          ...localMessage,
          decryptError: "missing recipient material for current device",
          lifecycle: "failed",
          failureCode: "message_decrypt_failed",
          retryableFailure: false,
        };
      }

      const keyCandidates = await loadAllDeviceKeyMaterials();
      let plaintext: string | null = null;
      for (const keys of keyCandidates) {
        try {
          plaintext = await cryptoProvider.decryptMessage({
            ciphertext: message.envelope.ciphertext,
            nonce: message.envelope.nonce,
            wrappedKey: recipient.wrappedKey,
            recipientPublicKey: keys.publicKey,
            recipientPrivateKey: keys.privateKey,
          });
          break;
        } catch {
          // Try next historical key candidate.
        }
      }
      if (plaintext === null) {
        throw new Error("message_decrypt_failed");
      }

      return {
        ...localMessage,
        plaintext: JSON.parse(plaintext),
        decryptError: undefined,
      };
    } catch (error) {
      return {
        ...localMessage,
        decryptError: error instanceof Error ? error.message : "message_decrypt_failed",
        lifecycle: "failed",
        failureCode: "message_decrypt_failed",
        retryableFailure: false,
      };
    }
  }

  private resolveRecipients(conversation: ConversationDTO) {
    const recipients: Array<{ recipientDeviceId: string; publicKey: string }> = [];
    const seen = new Set<string>();

    for (const member of conversation.members) {
      if (!member.isActive) {
        continue;
      }
      for (const device of member.trustedDevices) {
        if (device.status !== "trusted") {
          continue;
        }
        if (seen.has(device.id)) {
          continue;
        }
        seen.add(device.id);
        recipients.push({
          recipientDeviceId: device.id,
          publicKey: device.publicDeviceMaterial,
        });
      }
    }

    return recipients;
  }

  private async uploadAttachments(accessToken: string, uploads: UploadInput[]): Promise<MessageAttachmentSecret[]> {
    const result: MessageAttachmentSecret[] = [];
    for (const upload of uploads) {
      const encrypted = await cryptoProvider.encryptAttachment(upload.bytes);
      const kind = upload.mimeType.startsWith("image/") ? "image" : "file";
      const ciphertextBytes = base64ToBytes(encrypted.ciphertext);
      const response = await messagingApi.uploadAttachment(accessToken, {
        kind,
        fileName: upload.fileName,
        mimeType: upload.mimeType,
        sizeBytes: ciphertextBytes.byteLength,
        checksumSha256: encrypted.checksumSha256,
        algorithm: encrypted.algorithm,
        nonce: encrypted.nonce,
        ciphertext: encrypted.ciphertext,
      });

      result.push({
        attachmentId: response.attachment.id,
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

  private async flushOutbox() {
    this.flushOutboxRequested = true;
    if (this.flushOutboxRunning) {
      return;
    }

    this.flushOutboxRunning = true;
    try {
      while (this.flushOutboxRequested) {
        this.flushOutboxRequested = false;
        const accessToken = this.requireAccessToken();
        const outbox = await localEncryptedStore.listOutbox();
        if (outbox.length === 0) {
          useMessagingStore.getState().setOutbox([]);
          continue;
        }

        for (const item of outbox) {
          const session = useAuthStore.getState().session;
          if (session) {
            useMessagingStore
              .getState()
              .updateMessageLifecycle(item.conversationId, session.device.id, item.clientMessageId, { lifecycle: "sending" });
          }

          try {
            const response = await messagingApi.sendMessage(accessToken, item.conversationId, item.payload);
            await localEncryptedStore.deleteOutbox(item.clientMessageId);
            await localEncryptedStore.saveMessage(response.message);
            const hydrated = await this.hydrateMessage(response.message);
            useMessagingStore.getState().upsertMessage(item.conversationId, hydrated);
          } catch (error) {
            const classified = classifyMessagingError(error);
            if (classified.class === "retryable") {
              await localEncryptedStore.incrementOutboxRetry(item.clientMessageId);
            } else {
              await localEncryptedStore.deleteOutbox(item.clientMessageId);
            }

            if (session) {
              useMessagingStore.getState().updateMessageLifecycle(item.conversationId, session.device.id, item.clientMessageId, {
                lifecycle: "failed",
                retryableFailure: classified.class === "retryable",
                failureCode: classified.code,
              });
            }
          }
        }
        await this.refreshOutbox();
      }
    } finally {
      this.flushOutboxRunning = false;
    }
  }

  private async refreshOutbox() {
    const outbox = await localEncryptedStore.listOutbox();
    useMessagingStore.getState().setOutbox(outbox);
  }

  private requireAccessToken() {
    if (!this.accessToken) {
      const fromStore = useAuthStore.getState().accessToken;
      if (fromStore) {
        this.accessToken = fromStore;
      }
    }
    if (!this.accessToken) {
      throw new Error("unauthorized");
    }
    return this.accessToken;
  }

  private requireSession() {
    const session = useAuthStore.getState().session;
    if (!session) {
      throw new Error("missing auth session");
    }
    return session;
  }

  private createOptimisticMessage(input: {
    conversation: ConversationDTO;
    clientMessageId: string;
    text: string;
    ttlSeconds?: number;
    replyToMessageId?: string;
    senderAccountId: string;
    senderDeviceId: string;
  }): LocalMessage {
    const createdAt = new Date();
    const createdAtISO = createdAt.toISOString();
    const expiresAt =
      input.ttlSeconds && input.ttlSeconds > 0
        ? new Date(createdAt.getTime() + input.ttlSeconds * 1000).toISOString()
        : null;

    return {
      envelope: {
        id: `local-${input.clientMessageId}`,
        conversationId: input.conversation.id,
        senderAccountId: input.senderAccountId,
        senderDeviceId: input.senderDeviceId,
        clientMessageId: input.clientMessageId,
        algorithm: "pending",
        cryptoVersion: 1,
        nonce: "",
        ciphertext: "",
        recipients: [],
        attachments: [],
        replyToMessageId: input.replyToMessageId ?? null,
        ttlSeconds: safePositiveInt(input.ttlSeconds),
        createdAt: createdAtISO,
        expiresAt,
        serverSequence: 0,
      } as any,
      deliveryState: "queued",
      deliveredAt: null,
      failedReason: null,
      receipts: [],
      plaintext: {
        text: input.text,
        attachments: [],
        createdAt: createdAtISO,
      },
      lifecycle: "draft",
      lastUpdatedAt: createdAtISO,
    };
  }

  private sleep(ms: number) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  private reportWebSocketIssue(lastError: string, endpoint: string) {
    const currentTransport = useMessagingStore.getState().transport;
    if (currentTransport.mode === "long_poll") {
      useMessagingStore.getState().setTransportState({ lastError });
      return;
    }
    useMessagingStore.getState().setTransportState({
      mode: "websocket",
      status: this.longPollEnabled ? "degraded" : "offline",
      endpoint,
      lastError,
    });
  }
}

export const messagingRuntime = new MessagingRuntime();

function base64ToBytes(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function safePositiveInt(value?: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.floor(value);
}

function dedupeEndpoints(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of items) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}
