import type { LoginSuccessResponse, RegisterResponse } from "@project/protocol";

import { authApi } from "@/services/authApi";
import { REFRESH_TOKEN_KEY } from "@/services/authTokens";
import { logger } from "@/services/logger";
import { secureStorage } from "@/services/secureStorage";
import { useAuthStore } from "@/state/authStore";

export async function applySessionEnvelope(envelope: RegisterResponse | LoginSuccessResponse) {
  await secureStorage.set(REFRESH_TOKEN_KEY, envelope.tokens.refreshToken);
  useAuthStore.getState().setSessionFromEnvelope({
    ...envelope,
    recoveryCodes: envelope.recoveryCodes ?? [],
  });

  try {
    const sessionInfo = await authApi.session(envelope.tokens.accessToken);
    useAuthStore.getState().updateSessionDetails({
      email: sessionInfo.email,
      twoFactorEnabled: sessionInfo.twoFactorEnabled,
      identity: sessionInfo.identity,
      device: sessionInfo.device,
      session: sessionInfo.session,
    });
  } catch (error) {
    logger.warn("failed to hydrate session details", { error });
  }
}

export async function clearSession() {
  try {
    await secureStorage.delete(REFRESH_TOKEN_KEY);
  } catch (error) {
    logger.warn("failed to delete refresh token from secure storage", { error });
  }
  useAuthStore.getState().clearSession();
}
