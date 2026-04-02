import sodium from "libsodium-wrappers";

const MESSAGE_ALGORITHM = "xchacha20poly1305_ietf+sealedbox";
const KEY_WRAP_ALGORITHM = "x25519-sealedbox";
const ATTACHMENT_ALGORITHM = "xchacha20poly1305_ietf";
const EXPECTED_NONCE_BYTES = 24;

export interface RecipientPublicMaterial {
  recipientDeviceId: string;
  publicKey: string;
}

export interface WrappedRecipientKey {
  recipientDeviceId: string;
  wrappedKey: string;
  keyAlgorithm: string;
}

export interface IdentityKeyPair {
  publicKey: string;
  privateKey: string;
}

export interface EncryptedMessagePayload {
  algorithm: string;
  cryptoVersion: number;
  nonce: string;
  ciphertext: string;
  recipients: WrappedRecipientKey[];
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

export const cryptoProvider = {
  async generateIdentityKeyPair(): Promise<IdentityKeyPair> {
    const lib = await getSodium();
    const pair = lib.crypto_box_keypair();
    return {
      publicKey: toBase64(pair.publicKey, lib),
      privateKey: toBase64(pair.privateKey, lib),
    };
  },

  async encryptMessage(plaintext: string, recipients: RecipientPublicMaterial[]): Promise<EncryptedMessagePayload> {
    const lib = await getSodium();
    const symmetricKey = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
    const nonce = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const plaintextBytes = lib.from_string(plaintext);
    try {
      const ciphertext = lib.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintextBytes, null, null, nonce, symmetricKey);

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
      throw new Error("invalid nonce length");
    }
    const symmetricKey = lib.crypto_box_seal_open(wrappedKey, recipientPublicKey, recipientPrivateKey);
    try {
      const plaintext = lib.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonce, symmetricKey);
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
    const lib = await getSodium();
    const symmetricKey = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
    const nonce = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    try {
      const ciphertext = lib.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, null, null, nonce, symmetricKey);
      const checksum = lib.crypto_hash_sha256(ciphertext);

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
      throw new Error("invalid nonce length");
    }
    try {
      return lib.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonce, symmetricKey);
    } finally {
      wipeBytes(symmetricKey);
    }
  },

  async hashHex(value: string): Promise<string> {
    const lib = await getSodium();
    return lib.to_hex(lib.crypto_hash_sha256(lib.from_string(value)));
  },

  async hashBytesHex(value: Uint8Array): Promise<string> {
    const lib = await getSodium();
    return lib.to_hex(lib.crypto_hash_sha256(value));
  },

  async randomSymmetricKey(): Promise<string> {
    const lib = await getSodium();
    const key = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
    return toBase64(key, lib);
  },

  async encryptWithSymmetricKey(plaintext: string, keyBase64: string): Promise<{ nonce: string; ciphertext: string }> {
    const lib = await getSodium();
    const key = parseBase64(keyBase64, lib);
    const nonce = lib.randombytes_buf(lib.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    try {
      const ciphertext = lib.crypto_aead_xchacha20poly1305_ietf_encrypt(lib.from_string(plaintext), null, null, nonce, key);
      return {
        nonce: toBase64(nonce, lib),
        ciphertext: toBase64(ciphertext, lib),
      };
    } finally {
      wipeBytes(key);
    }
  },

  async decryptWithSymmetricKey(ciphertextBase64: string, nonceBase64: string, keyBase64: string): Promise<string> {
    const lib = await getSodium();
    const key = parseBase64(keyBase64, lib);
    const nonce = parseBase64(nonceBase64, lib);
    const ciphertext = parseBase64(ciphertextBase64, lib);
    if (nonce.length !== EXPECTED_NONCE_BYTES) {
      throw new Error("invalid nonce length");
    }
    try {
      const plaintext = lib.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ciphertext, null, nonce, key);
      try {
        return lib.to_string(plaintext);
      } finally {
        wipeBytes(plaintext);
      }
    } finally {
      wipeBytes(key);
    }
  },
};

function wipeBytes(value: Uint8Array | null | undefined) {
  if (!value) {
    return;
  }
  value.fill(0);
}
