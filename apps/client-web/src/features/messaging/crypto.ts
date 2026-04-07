import sodium from "libsodium-wrappers";

const MESSAGE_ALGORITHM = "xchacha20poly1305_ietf+sealedbox";
const KEY_WRAP_ALGORITHM = "x25519-sealedbox";
const ATTACHMENT_ALGORITHM = "xchacha20poly1305_ietf";
const EXPECTED_NONCE_BYTES = 24;

type SodiumLike = typeof sodium & {
  crypto_hash_sha256?: (input: Uint8Array) => Uint8Array;
};

export interface IdentityKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface RecipientPublicMaterial {
  recipientDeviceId: string;
  publicKey: string;
}

export interface EncryptedMessagePayload {
  algorithm: string;
  cryptoVersion: number;
  nonce: string;
  ciphertext: string;
  recipients: Array<{
    recipientDeviceId: string;
    wrappedKey: string;
    keyAlgorithm: string;
  }>;
}

export interface EncryptedAttachmentPayload {
  algorithm: string;
  nonce: string;
  ciphertext: string;
  symmetricKey: string;
  checksumSha256: string;
}

async function getSodium() {
  await sodium.ready;
  return sodium;
}

function parseBase64(value: string, lib: typeof sodium): Uint8Array {
  return lib.from_base64(value, lib.base64_variants.ORIGINAL);
}

function toBase64(value: Uint8Array, lib: typeof sodium): string {
  return lib.to_base64(value, lib.base64_variants.ORIGINAL);
}

async function hashSha256(value: Uint8Array, lib: SodiumLike): Promise<Uint8Array> {
  if (typeof lib.crypto_hash_sha256 === "function") {
    return lib.crypto_hash_sha256(value);
  }
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const bytes = new Uint8Array(value);
    const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes.buffer);
    return new Uint8Array(digest);
  }
  throw new Error("sha256_unavailable");
}

function wipeBytes(value: Uint8Array | null | undefined) {
  if (!value) {
    return;
  }
  value.fill(0);
}

export const webCryptoProvider = {
  async generateIdentityKeyPair(): Promise<IdentityKeyPair> {
    const lib = await getSodium();
    const pair = lib.crypto_box_keypair();
    return {
      publicKey: toBase64(pair.publicKey, lib),
      privateKey: toBase64(pair.privateKey, lib),
    };
  },

  async fingerprint(publicMaterial: string): Promise<string> {
    const lib = (await getSodium()) as SodiumLike;
    return lib.to_hex(await hashSha256(parseBase64(publicMaterial, lib), lib));
  },

  async encryptMessage(plaintext: string, recipients: RecipientPublicMaterial[]): Promise<EncryptedMessagePayload> {
    const lib = await getSodium();
    const symmetricKey = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
    const nonce = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const plaintextBytes = lib.from_string(plaintext);
    try {
      const ciphertext = lib.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plaintextBytes,
        null,
        null,
        nonce,
        symmetricKey,
      );
      const wrapped = recipients.map((recipient) => {
        const recipientPublic = parseBase64(recipient.publicKey, lib);
        const wrappedKey = lib.crypto_box_seal(symmetricKey, recipientPublic);
        return {
          recipientDeviceId: recipient.recipientDeviceId,
          wrappedKey: toBase64(wrappedKey, lib),
          keyAlgorithm: KEY_WRAP_ALGORITHM,
        };
      });
      return {
        algorithm: MESSAGE_ALGORITHM,
        cryptoVersion: 1,
        nonce: toBase64(nonce, lib),
        ciphertext: toBase64(ciphertext, lib),
        recipients: wrapped,
      };
    } finally {
      wipeBytes(symmetricKey);
      wipeBytes(plaintextBytes);
    }
  },

  async decryptMessage(options: {
    ciphertext: string;
    nonce: string;
    wrappedKey: string;
    recipientPublicKey: string;
    recipientPrivateKey: string;
  }): Promise<string> {
    const lib = await getSodium();
    const ciphertext = parseBase64(options.ciphertext, lib);
    const nonce = parseBase64(options.nonce, lib);
    const wrappedKey = parseBase64(options.wrappedKey, lib);
    const recipientPublicKey = parseBase64(options.recipientPublicKey, lib);
    const recipientPrivateKey = parseBase64(options.recipientPrivateKey, lib);
    if (nonce.length !== EXPECTED_NONCE_BYTES) {
      throw new Error("invalid nonce");
    }
    const symmetricKey = lib.crypto_box_seal_open(wrappedKey, recipientPublicKey, recipientPrivateKey);
    try {
      const plaintext = lib.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        ciphertext,
        null,
        nonce,
        symmetricKey,
      );
      try {
        return lib.to_string(plaintext);
      } finally {
        wipeBytes(plaintext);
      }
    } finally {
      wipeBytes(symmetricKey);
    }
  },

  async encryptAttachment(plaintext: Uint8Array): Promise<EncryptedAttachmentPayload> {
    const lib = (await getSodium()) as SodiumLike;
    const symmetricKey = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
    const nonce = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    try {
      const ciphertext = lib.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, symmetricKey);
      const checksum = await hashSha256(ciphertext, lib);
      return {
        algorithm: ATTACHMENT_ALGORITHM,
        nonce: toBase64(nonce, lib),
        ciphertext: toBase64(ciphertext, lib),
        symmetricKey: toBase64(symmetricKey, lib),
        checksumSha256: lib.to_hex(checksum),
      };
    } finally {
      wipeBytes(symmetricKey);
    }
  },

  async decryptAttachment(options: { ciphertext: string; nonce: string; symmetricKey: string }): Promise<Uint8Array> {
    const lib = await getSodium();
    const ciphertext = parseBase64(options.ciphertext, lib);
    const nonce = parseBase64(options.nonce, lib);
    const symmetricKey = parseBase64(options.symmetricKey, lib);
    if (nonce.length !== EXPECTED_NONCE_BYTES) {
      throw new Error("invalid nonce");
    }
    try {
      return lib.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonce, symmetricKey);
    } finally {
      wipeBytes(symmetricKey);
    }
  },

  async hashBytesHex(value: Uint8Array): Promise<string> {
    const lib = (await getSodium()) as SodiumLike;
    return lib.to_hex(await hashSha256(value, lib));
  },
};
