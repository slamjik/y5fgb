function randomBytes(length: number): Uint8Array {
  const globalCrypto = globalThis.crypto;
  if (globalCrypto && typeof globalCrypto.getRandomValues === "function") {
    const value = new Uint8Array(length);
    globalCrypto.getRandomValues(value);
    return value;
  }

  const value = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) {
    value[index] = Math.floor(Math.random() * 256);
  }
  return value;
}

function byteToHex(value: number): string {
  return value.toString(16).padStart(2, "0");
}

export function randomID(): string {
  const globalCrypto = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (globalCrypto && typeof globalCrypto.randomUUID === "function") {
    return globalCrypto.randomUUID();
  }

  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(byteToHex);
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex.slice(6, 8).join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}
