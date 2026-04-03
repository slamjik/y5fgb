import { cryptoProvider } from "@/services/messaging/cryptoProvider";
import { secureStorage } from "@/services/secureStorage";
import { randomID } from "@/lib/randomId";

const ACCOUNT_PRIVATE_KEY = "identity.account.private";
const ACCOUNT_PUBLIC_KEY = "identity.account.public";
const DEVICE_PRIVATE_KEY = "identity.device.private";
const DEVICE_PUBLIC_KEY = "identity.device.public";
const DEVICE_LEGACY_KEYS = "identity.device.legacy_keys";
const DEVICE_ID = "identity.device.id";
const DEVICE_NAME = "identity.device.name";

const encoder = new TextEncoder();

export interface IdentityMaterial {
  publicMaterial: string;
  privateMaterial: string;
  fingerprint: string;
}

export interface DeviceIdentityMaterial extends IdentityMaterial {
  deviceId: string;
  deviceName: string;
}

export async function createAccountIdentity(): Promise<IdentityMaterial> {
  const generated = await generateIdentityPair();
  await secureStorage.set(ACCOUNT_PRIVATE_KEY, generated.privateMaterial);
  await secureStorage.set(ACCOUNT_PUBLIC_KEY, generated.publicMaterial);
  return generated;
}

export async function loadOrCreateDeviceIdentity(deviceName: string): Promise<DeviceIdentityMaterial> {
  const existingPublic = await secureStorage.get(DEVICE_PUBLIC_KEY);
  const existingPrivate = await secureStorage.get(DEVICE_PRIVATE_KEY);
  const existingId = await secureStorage.get(DEVICE_ID);

  if (existingPublic && existingPrivate && existingId) {
    const fingerprint = await fingerprintFromMaterial(existingPublic);
    await secureStorage.set(DEVICE_NAME, deviceName);
    return {
      deviceId: existingId,
      deviceName,
      publicMaterial: existingPublic,
      privateMaterial: existingPrivate,
      fingerprint,
    };
  }

  const generated = await generateIdentityPair();
  const deviceId = randomID();

  await secureStorage.set(DEVICE_PRIVATE_KEY, generated.privateMaterial);
  await secureStorage.set(DEVICE_PUBLIC_KEY, generated.publicMaterial);
  await secureStorage.set(DEVICE_ID, deviceId);
  await secureStorage.set(DEVICE_NAME, deviceName);

  return {
    deviceId,
    deviceName,
    publicMaterial: generated.publicMaterial,
    privateMaterial: generated.privateMaterial,
    fingerprint: generated.fingerprint,
  };
}

export async function loadCurrentDeviceKeyMaterial() {
  const publicKey = await secureStorage.get(DEVICE_PUBLIC_KEY);
  const privateKey = await secureStorage.get(DEVICE_PRIVATE_KEY);
  if (!publicKey || !privateKey) {
    throw new Error("device identity is not initialized");
  }
  return { publicKey, privateKey };
}

export async function loadAllDeviceKeyMaterials(): Promise<Array<{ publicKey: string; privateKey: string }>> {
  const current = await loadCurrentDeviceKeyMaterial();
  const keys: Array<{ publicKey: string; privateKey: string }> = [current];
  const legacyRaw = await secureStorage.get(DEVICE_LEGACY_KEYS);
  if (!legacyRaw) {
    return keys;
  }

  try {
    const parsed = JSON.parse(legacyRaw) as Array<{ publicKey?: string; privateKey?: string }>;
    for (const item of parsed) {
      if (!item || typeof item.publicKey !== "string" || typeof item.privateKey !== "string") {
        continue;
      }
      keys.push({ publicKey: item.publicKey, privateKey: item.privateKey });
    }
  } catch {
    // Corrupted legacy payload should not break key loading path.
  }

  return keys;
}

export async function rotateCurrentDeviceIdentity(): Promise<DeviceIdentityMaterial> {
  const candidate = await generateDeviceIdentityCandidate();
  await commitDeviceIdentityRotation(candidate);
  return candidate;
}

export async function generateDeviceIdentityCandidate(): Promise<DeviceIdentityMaterial> {
  const existingDeviceID = await secureStorage.get(DEVICE_ID);
  const existingDeviceName = (await secureStorage.get(DEVICE_NAME)) ?? "Desktop device";
  if (!existingDeviceID) {
    throw new Error("device identity is not initialized");
  }

  const generated = await generateIdentityPair();
  return {
    deviceId: existingDeviceID,
    deviceName: existingDeviceName,
    publicMaterial: generated.publicMaterial,
    privateMaterial: generated.privateMaterial,
    fingerprint: generated.fingerprint,
  };
}

export async function commitDeviceIdentityRotation(next: DeviceIdentityMaterial): Promise<void> {
  const current = await loadCurrentDeviceKeyMaterial();
  const existingDeviceID = await secureStorage.get(DEVICE_ID);
  if (!existingDeviceID) {
    throw new Error("device identity is not initialized");
  }

  const legacyRaw = await secureStorage.get(DEVICE_LEGACY_KEYS);
  const legacy = parseLegacy(legacyRaw);
  legacy.unshift(current);
  const normalizedLegacy = dedupeLegacy(legacy).slice(0, 5);
  await secureStorage.set(DEVICE_LEGACY_KEYS, JSON.stringify(normalizedLegacy));

  if (next.deviceId !== existingDeviceID) {
    throw new Error("rotation candidate device id mismatch");
  }
  await secureStorage.set(DEVICE_PRIVATE_KEY, next.privateMaterial);
  await secureStorage.set(DEVICE_PUBLIC_KEY, next.publicMaterial);
  await secureStorage.set(DEVICE_NAME, next.deviceName);
}

async function generateIdentityPair(): Promise<IdentityMaterial> {
  const keyPair = await cryptoProvider.generateIdentityKeyPair();
  const publicMaterial = keyPair.publicKey;
  const privateMaterial = keyPair.privateKey;
  const fingerprint = await fingerprintFromMaterial(publicMaterial);

  return { publicMaterial, privateMaterial, fingerprint };
}

export async function fingerprintFromMaterial(material: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(material.trim()));
  return Array.from(new Uint8Array(digest))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function parseLegacy(raw: string | null): Array<{ publicKey: string; privateKey: string }> {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw) as Array<{ publicKey?: string; privateKey?: string }>;
    return parsed
      .filter((item): item is { publicKey: string; privateKey: string } => typeof item?.publicKey === "string" && typeof item?.privateKey === "string")
      .map((item) => ({ publicKey: item.publicKey, privateKey: item.privateKey }));
  } catch {
    return [];
  }
}

function dedupeLegacy(items: Array<{ publicKey: string; privateKey: string }>) {
  const seen = new Set<string>();
  const result: Array<{ publicKey: string; privateKey: string }> = [];
  for (const item of items) {
    const key = `${item.publicKey}:${item.privateKey}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(item);
  }
  return result;
}
