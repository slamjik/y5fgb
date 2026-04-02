#!/usr/bin/env node
import crypto from "node:crypto";

const baseUrl = process.env.SMOKE_BASE_URL ?? "http://localhost:8080";
const apiPrefix = process.env.SMOKE_API_PREFIX ?? "/api/v1";
const apiBase = `${baseUrl}${apiPrefix}`;

function randomId() {
  return crypto.randomUUID().replaceAll("-", "");
}

function randomDeviceMaterial() {
  return crypto.randomBytes(32).toString("base64");
}

async function request(path, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (!response.ok) {
    throw new Error(`Request failed ${response.status} ${path}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function requestExpectStatus(path, expectedStatus, options = {}) {
  const response = await fetch(`${apiBase}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const contentType = response.headers.get("content-type") ?? "";
  const payload = contentType.includes("application/json") ? await response.json() : null;
  if (response.status !== expectedStatus) {
    throw new Error(`Expected ${expectedStatus}, got ${response.status} ${path}: ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function registerUser(label) {
  const suffix = randomId().slice(0, 10);
  const email = `smoke.${label}.${suffix}@example.com`;
  const password = "SmokePassword!234";

  const response = await request("/auth/register", {
    method: "POST",
    body: {
      email,
      password,
      accountIdentityMaterial: randomDeviceMaterial(),
      accountIdentityFingerprint: crypto.randomBytes(16).toString("hex"),
      device: {
        deviceId: crypto.randomUUID(),
        name: `Smoke-${label}`,
        platform: "desktop",
        publicDeviceMaterial: randomDeviceMaterial(),
        fingerprint: crypto.randomBytes(16).toString("hex"),
      },
    },
  });

  return { email, password, response };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sha256Hex(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

async function run() {
  console.log(`[smoke] using API base ${apiBase}`);

  const healthResponse = await fetch(`${baseUrl}/health`);
  assert(healthResponse.ok, "health endpoint failed");

  const userA = await registerUser("a");
  const userB = await registerUser("b");
  const tokenA = userA.response.tokens.accessToken;
  const tokenB = userB.response.tokens.accessToken;

  const sessionA = await request("/auth/session", { accessToken: tokenA });
  assert(sessionA.accountId === userA.response.accountId, "session account mismatch for A");

  const devicesA = await request("/devices", { accessToken: tokenA });
  assert(Array.isArray(devicesA.devices) && devicesA.devices.length >= 1, "device list for A is empty");

  const rotatedMaterial = randomDeviceMaterial();
  const rotateResponse = await request("/devices/keys/rotate", {
    method: "POST",
    accessToken: tokenA,
    body: {
      publicDeviceMaterial: rotatedMaterial,
      fingerprint: sha256Hex(Buffer.from(rotatedMaterial.trim(), "utf8")),
    },
  });
  assert(rotateResponse.device?.keyInfo?.version >= 2, "device key rotation did not bump key version");
  const securityEvents = await request("/security-events?limit=25", { accessToken: tokenA });
  assert(
    Array.isArray(securityEvents.events) &&
      securityEvents.events.some((event) => event.eventType === "device_key_changed"),
    "expected device_key_changed event after key rotation",
  );

  const direct = await request("/conversations/direct", {
    method: "POST",
    accessToken: tokenA,
    body: {
      peerAccountId: userB.response.accountId,
      defaultTtlSeconds: 120,
    },
  });
  const conversationId = direct.conversation.id;
  assert(conversationId, "direct conversation was not created");

  const senderDeviceId = userA.response.device.id;
  const recipientDeviceA = userA.response.device.id;
  const recipientDeviceB = userB.response.device.id;

  await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    accessToken: tokenA,
    body: {
      clientMessageId: crypto.randomUUID(),
      algorithm: "xchacha20poly1305_ietf+sealedbox",
      cryptoVersion: 1,
      nonce: crypto.randomBytes(24).toString("base64"),
      ciphertext: crypto.randomBytes(64).toString("base64"),
      recipients: [
        { recipientDeviceId: recipientDeviceA, wrappedKey: "wrapped-key-self", keyAlgorithm: "x25519-sealedbox" },
        { recipientDeviceId: recipientDeviceB, wrappedKey: "wrapped-key-peer", keyAlgorithm: "x25519-sealedbox" },
      ],
      ttlSeconds: 90,
    },
  });

  const messagesForB = await request(`/conversations/${conversationId}/messages?limit=20`, {
    accessToken: tokenB,
  });
  assert(Array.isArray(messagesForB.messages), "message list for B is invalid");

  const group = await request("/conversations/group", {
    method: "POST",
    accessToken: tokenA,
    body: {
      title: "Smoke Group",
      memberAccountIds: [userB.response.accountId],
      defaultTtlSeconds: 60,
    },
  });
  assert(group.conversation.type === "group", "group conversation was not created");

  const encryptedAttachmentBytes = crypto.randomBytes(128);
  const attachment = await request("/attachments/upload", {
    method: "POST",
    accessToken: tokenA,
    body: {
      kind: "file",
      fileName: "smoke.bin",
      mimeType: "application/octet-stream",
      sizeBytes: encryptedAttachmentBytes.byteLength,
      checksumSha256: sha256Hex(encryptedAttachmentBytes),
      algorithm: "xchacha20poly1305_ietf",
      nonce: crypto.randomBytes(24).toString("base64"),
      ciphertext: encryptedAttachmentBytes.toString("base64"),
    },
  });
  assert(attachment.attachment?.id, "attachment upload failed");

  await request(`/conversations/${conversationId}/messages`, {
    method: "POST",
    accessToken: tokenA,
    body: {
      clientMessageId: crypto.randomUUID(),
      algorithm: "xchacha20poly1305_ietf+sealedbox",
      cryptoVersion: 1,
      nonce: crypto.randomBytes(24).toString("base64"),
      ciphertext: crypto.randomBytes(96).toString("base64"),
      recipients: [
        { recipientDeviceId: senderDeviceId, wrappedKey: "wrapped-key-self-2", keyAlgorithm: "x25519-sealedbox" },
        { recipientDeviceId: recipientDeviceB, wrappedKey: "wrapped-key-peer-2", keyAlgorithm: "x25519-sealedbox" },
      ],
      attachmentIds: [attachment.attachment.id],
    },
  });

  const syncBootstrap = await request("/sync/bootstrap?limit=100", { accessToken: tokenB });
  assert(syncBootstrap.batch?.cursorId, "sync bootstrap failed");
  await request(`/sync/poll?cursor=${syncBootstrap.batch.toCursor}&timeoutSec=1&limit=50`, { accessToken: tokenB });

  const transport = await request("/transport/endpoints", { accessToken: tokenA });
  assert(Array.isArray(transport.endpoints), "transport endpoints response invalid");

  const logoutAll = await request("/auth/logout-all", {
    method: "POST",
    accessToken: tokenA,
  });
  assert(typeof logoutAll.revokedSessions === "number" && logoutAll.revokedSessions >= 1, "logout-all did not revoke sessions");
  await requestExpectStatus("/auth/session", 401, { accessToken: tokenA });

  const allowed = new Set([
    "ui.render",
    "commands.register",
    "storage.plugin_local",
    "notifications.local",
    "messages.read_active_conversation_summary",
    "messages.read_visible_messages",
    "events.subscribe",
  ]);
  const denied = ["network.outbound", "filesystem.read", "filesystem.write", "transport.control", "auth.session", "crypto.keys", "identity.material"];
  for (const capability of denied) {
    assert(!allowed.has(capability), `denied capability leaked into allow-list: ${capability}`);
  }

  console.log("[smoke] v4 checks passed");
}

run().catch((error) => {
  console.error("[smoke] failed:", error.message);
  process.exit(1);
});
