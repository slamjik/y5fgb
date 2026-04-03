export type CryptoSupportLevel = "full" | "partial" | "blocked";

export interface IdentityMaterialPair {
  publicMaterial: string;
  privateMaterial: string;
}

export interface CryptoFacade {
  supportLevel(): CryptoSupportLevel;
  generateIdentityMaterial(): Promise<IdentityMaterialPair>;
  encryptMessage(plaintext: string): Promise<{ ciphertext: string; nonce: string }>;
  decryptMessage(ciphertext: string, nonce: string): Promise<string>;
}

export class CryptoUnavailableForPlatformError extends Error {
  readonly code = "crypto_unavailable_for_platform";

  constructor(message = "crypto is unavailable for current platform") {
    super(message);
  }
}

export const blockedCryptoFacade: CryptoFacade = {
  supportLevel: () => "blocked",
  async generateIdentityMaterial() {
    throw new CryptoUnavailableForPlatformError();
  },
  async encryptMessage() {
    throw new CryptoUnavailableForPlatformError();
  },
  async decryptMessage() {
    throw new CryptoUnavailableForPlatformError();
  },
};
