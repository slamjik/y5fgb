import type { RecoveryCompleteRequest, RecoveryStartRequest, RecoveryStartResponse } from "@project/protocol";

import { apiRequest } from "@/services/apiClient";

export const recoveryApi = {
  start(payload: RecoveryStartRequest) {
    return apiRequest<RecoveryStartResponse>({
      path: "/recovery/start",
      method: "POST",
      body: payload,
    });
  },

  complete(payload: RecoveryCompleteRequest) {
    return apiRequest<{ completed: true }>({
      path: "/recovery/complete",
      method: "POST",
      body: payload,
    });
  },
};
