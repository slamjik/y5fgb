import { authApi } from "@/services/authApi";
import { applySessionEnvelope, clearSession } from "@/services/authSession";
import { REFRESH_TOKEN_KEY } from "@/services/authTokens";
import { logger } from "@/services/logger";
import { secureStorage } from "@/services/secureStorage";
import { useAuthStore } from "@/state/authStore";

export async function bootstrapSession() {
  let refreshToken: string | null = null;
  try {
    refreshToken = await secureStorage.get(REFRESH_TOKEN_KEY);
  } catch (error) {
    logger.warn("failed to read refresh token from secure storage", { error });
    await clearSession();
    useAuthStore.getState().setInitialized(true);
    return;
  }

  if (!refreshToken) {
    useAuthStore.getState().clearSession();
    useAuthStore.getState().setInitialized(true);
    return;
  }

  try {
    const envelope = await authApi.refresh(refreshToken);
    await applySessionEnvelope(envelope);
  } catch (error) {
    logger.warn("session bootstrap failed, clearing local auth state", { error });
    await clearSession();
  } finally {
    useAuthStore.getState().setInitialized(true);
  }
}
