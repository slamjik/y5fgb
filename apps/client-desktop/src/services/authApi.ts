import type {
  AuthSessionResponse,
  LoginPendingApprovalResponse,
  LoginRequest,
  LoginSuccessResponse,
  LoginTwoFactorRequiredResponse,
  LogoutAllResponse,
  RegisterRequest,
  RegisterResponse,
  TwoFactorLoginVerifyRequest,
} from "@project/protocol";

import { ApiClientError, apiRequest } from "@/services/apiClient";

export type LoginOutcome =
  | { kind: "success"; data: LoginSuccessResponse }
  | { kind: "pending"; data: LoginPendingApprovalResponse }
  | { kind: "two_fa"; data: LoginTwoFactorRequiredResponse };

export const authApi = {
  register(payload: RegisterRequest) {
    return apiRequest<RegisterResponse>({
      path: "/auth/register",
      method: "POST",
      body: payload,
    });
  },

  async login(payload: LoginRequest): Promise<LoginOutcome> {
    try {
      const data = await apiRequest<LoginSuccessResponse | LoginPendingApprovalResponse>({
        path: "/auth/login",
        method: "POST",
        body: payload,
      });

      if ("approvalRequestId" in data) {
        return { kind: "pending", data };
      }

      return { kind: "success", data };
    } catch (error) {
      if (!(error instanceof ApiClientError)) {
        throw error;
      }

      if (error.status === 401) {
        const payload = error.payload as {
          error?: { code?: string };
          challengeId?: string;
          loginToken?: string;
          expiresAt?: string;
        };

        if (payload.error?.code === "two_fa_required") {
          return {
            kind: "two_fa",
            data: {
              challengeId: payload.challengeId ?? "",
              loginToken: payload.loginToken ?? "",
              expiresAt: payload.expiresAt as any,
            },
          };
        }
      }

      throw error;
    }
  },

  verifyTwoFALogin(payload: TwoFactorLoginVerifyRequest) {
    return apiRequest<LoginSuccessResponse>({
      path: "/auth/2fa/login/verify",
      method: "POST",
      body: payload,
    });
  },

  refresh(refreshToken: string) {
    return apiRequest<LoginSuccessResponse>({
      path: "/auth/refresh",
      method: "POST",
      body: { refreshToken },
    });
  },

  logout(accessToken: string | null, refreshToken?: string) {
    return apiRequest<{ ok: true }>({
      path: "/auth/logout",
      method: "POST",
      body: refreshToken ? { refreshToken } : undefined,
      accessToken: accessToken ?? undefined,
    });
  },

  logoutAll(accessToken: string) {
    return apiRequest<LogoutAllResponse>({
      path: "/auth/logout-all",
      method: "POST",
      accessToken,
    });
  },

  session(accessToken: string) {
    return apiRequest<AuthSessionResponse>({
      path: "/auth/session",
      method: "GET",
      accessToken,
    });
  },

  startTwoFA(accessToken: string) {
    return apiRequest<{ secret: string; provisioningUri: string }>({
      path: "/auth/2fa/setup/start",
      method: "POST",
      accessToken,
    });
  },

  confirmTwoFA(accessToken: string, code: string) {
    return apiRequest<{ enabled: true; recoveryCodes: string[] }>({
      path: "/auth/2fa/setup/confirm",
      method: "POST",
      accessToken,
      body: { code },
    });
  },

  disableTwoFA(accessToken: string, code: string) {
    return apiRequest<{ disabled: true }>({
      path: "/auth/2fa/disable",
      method: "POST",
      accessToken,
      body: { code },
    });
  },
};
