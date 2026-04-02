import type {
  DeviceApprovalsStatusResponse,
  DeviceListResponse,
  DeviceRotateKeyResponse,
} from "@project/protocol";

import { apiRequest } from "@/services/apiClient";

export const devicesApi = {
  list(accessToken: string) {
    return apiRequest<DeviceListResponse>({
      path: "/devices",
      method: "GET",
      accessToken,
    });
  },

  approve(accessToken: string, approvalRequestId: string, twoFactorCode?: string) {
    return apiRequest<{ approved: true }>({
      path: "/devices/approve",
      method: "POST",
      accessToken,
      body: { approvalRequestId, twoFactorCode },
    });
  },

  reject(accessToken: string, approvalRequestId: string, twoFactorCode?: string) {
    return apiRequest<{ rejected: true }>({
      path: "/devices/reject",
      method: "POST",
      accessToken,
      body: { approvalRequestId, twoFactorCode },
    });
  },

  revoke(accessToken: string, deviceId: string, twoFactorCode?: string) {
    return apiRequest<{ revoked: true }>({
      path: "/devices/revoke",
      method: "POST",
      accessToken,
      body: { deviceId, twoFactorCode },
    });
  },

  rotateKey(accessToken: string, payload: { publicDeviceMaterial: string; fingerprint?: string; twoFactorCode?: string }) {
    return apiRequest<DeviceRotateKeyResponse>({
      path: "/devices/keys/rotate",
      method: "POST",
      accessToken,
      body: payload,
    });
  },

  approvalStatus(approvalRequestId: string, pollToken: string) {
    const query = new URLSearchParams({ approvalRequestId, pollToken }).toString();
    return apiRequest<DeviceApprovalsStatusResponse>({
      path: `/devices/approvals/status?${query}`,
      method: "GET",
    });
  },
};
